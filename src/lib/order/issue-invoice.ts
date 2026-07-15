import "server-only";
import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildInvoiceRelateNumber } from "@/lib/ecpay/invoice/relate-number";
import { callIssue, getIssueByRelateNumber } from "@/lib/ecpay/invoice/issue";
import {
  invoiceMetaSchema,
  parseInvoiceTargetFromMeta,
  type InvoiceMeta,
} from "@/lib/order/invoice-meta";

type ServiceRole = ReturnType<typeof createServiceRoleClient>;

export type IssueInvoiceForOrderResult =
  | { ok: true; invoiceNo: string; alreadyIssued: boolean }
  | { ok: false; error: string };

// ECPay CustomerEmail 上限 80 字（官方 7896）；checkout 允許到 254（帳號用），
// 超過就不送 email（Phone/Email 官方規則擇一即可，phone 必有）
const ECPAY_CUSTOMER_EMAIL_MAX = 80;

// 開立核心：webhook 自動開立與後台手動補開共用同一支，天生冪等——
// invoice_status !== 'none' 直接短路成功；CAS 條件式 UPDATE 防並發雙開；
// Issue 失敗時以 GetIssue（RelateNumber）判別「其實已開立」並取回真號碼。
// 依藍圖鐵律：本函式**絕不 throw**，所有失敗都走結構化回傳。
export async function issueInvoiceForOrder(
  serviceRole: ServiceRole,
  orderId: string,
): Promise<IssueInvoiceForOrderResult> {
  const { data: order, error: orderError } = await serviceRole
    .from("orders")
    .select(
      `id, status, invoice_no, invoice_status, invoice_meta, total_amount,
       recipient_name, recipient_phone, shipping_address,
       member:member_id(email),
       order_item(quantity, unit_price_snapshot, product_name_snapshot)`,
    )
    .eq("id", orderId)
    .maybeSingle();

  if (orderError) {
    return { ok: false, error: `查詢訂單失敗：${orderError.message}` };
  }
  if (!order) {
    return { ok: false, error: "找不到訂單" };
  }
  if (order.status !== "paid") {
    return { ok: false, error: "訂單尚未付款，無法開立發票" };
  }
  // 冪等短路：已開立（或已折讓/作廢，代表曾經開立過）直接回成功
  if (order.invoice_status !== "none") {
    return {
      ok: true,
      invoiceNo: order.invoice_no ?? "",
      alreadyIssued: true,
    };
  }

  const memberData = order.member;
  const email = Array.isArray(memberData)
    ? memberData[0]?.email
    : memberData?.email;
  if (!email) {
    return { ok: false, error: "查無客戶 Email，無法開立發票" };
  }

  const { data: paidPayment, error: paymentError } = await serviceRole
    .from("payment")
    .select("merchant_trade_no")
    .eq("order_id", orderId)
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (paymentError) {
    return { ok: false, error: `查詢付款記錄失敗：${paymentError.message}` };
  }
  if (!paidPayment) {
    return { ok: false, error: "查無已付款的付款記錄，無法開立發票" };
  }

  const items = (Array.isArray(order.order_item) ? order.order_item : []).map(
    (item) => ({
      // product_name_snapshot 理論上下單當下必寫入，但欄位本身 nullable
      // （0005 backfill 遺留），fallback 比照 order-confirmation.ts 的慣例
      name: item.product_name_snapshot ?? "商品",
      quantity: item.quantity,
      unitPrice: Number(item.unit_price_snapshot),
    }),
  );
  if (items.length === 0) {
    return { ok: false, error: "訂單無品項，無法開立發票" };
  }

  // 品項加總與訂單總額的差額（現況 shipping_fee=0 恆為 0）：
  // 正差＝運費等附加費用，補一筆品項讓 ItemAmount 加總＝SalesAmount（官方
  // 硬性規則），T48 運費上線時這裡自動吸收；負差＝折抵，目前不支援，明確擋下
  const totalAmount = Number(order.total_amount);
  const itemsSum = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const diff = totalAmount - itemsSum;
  if (diff > 0) {
    items.push({ name: "運費", quantity: 1, unitPrice: diff });
  } else if (diff < 0) {
    return {
      ok: false,
      error: `訂單總額（${totalAmount}）低於品項加總（${itemsSum}），折抵金額尚不支援開立發票`,
    };
  }

  const relateNumber = buildInvoiceRelateNumber(paidPayment.merchant_trade_no);
  const target = parseInvoiceTargetFromMeta(order.invoice_meta);

  // 買家欄位正規化到 ECPay 限制：CustomerPhone 僅數字（結帳 regex 允許連字號）；
  // CustomerEmail 超過 80 字就不送（Phone/Email 擇一即可）
  const customerPhone = order.recipient_phone.replace(/\D/g, "");
  const customerEmail =
    email.length <= ECPAY_CUSTOMER_EMAIL_MAX ? email : "";

  // callIssue 依契約不 throw，但這裡是金流 webhook 的必經之路，防衛性再包一層
  let issueResult: Awaited<ReturnType<typeof callIssue>>;
  try {
    issueResult = await callIssue({
      relateNumber,
      target,
      customerName: order.recipient_name,
      customerAddr: order.shipping_address,
      customerPhone,
      customerEmail,
      totalAmount,
      items,
    });
  } catch (e) {
    issueResult = {
      ok: false,
      error: `開立發票非預期例外：${e instanceof Error ? e.message : String(e)}`,
    };
  }

  let invoiceNo: string;
  let invoiceDate: string;
  let randomNumber: string;

  if (issueResult.ok) {
    ({ invoiceNo, invoiceDate, randomNumber } = issueResult);
  } else {
    // Issue 失敗：先查 GetIssue（RelateNumber）判別是否「其實已開立」——
    // 上次呼叫成功但本地寫入被中斷、或並發呼叫先開走了。查得到＝冪等生效，
    // 直接取回真實號碼寫入；查不到＝真正失敗，交呼叫端（Sentry＋後台補開）。
    // 這個存在性檢查取代舊的 RtnMsg 文字比對（ECPay 換措辭即失效）。
    const existing = await getIssueByRelateNumber(relateNumber);
    if (!existing.found) {
      return { ok: false, error: issueResult.error };
    }
    ({ invoiceNo, invoiceDate, randomNumber } = existing);
  }

  // CAS：只有 invoice_status 仍是 none 時才寫入，防兩個並發呼叫都寫一次
  const metaParsed = invoiceMetaSchema.safeParse(order.invoice_meta);
  const nextMeta: InvoiceMeta = {
    ...(metaParsed.success ? metaParsed.data : {}),
    random_number: randomNumber,
    invoice_date: invoiceDate,
  };
  const { data: updated, error: updateError } = await serviceRole
    .from("orders")
    .update({
      invoice_no: invoiceNo,
      invoice_status: "issued",
      invoice_meta: nextMeta,
    })
    .eq("id", orderId)
    .eq("invoice_status", "none")
    .select("id");

  if (updateError) {
    // 發票已在 ECPay 端開立成功，本地寫入失敗——記清楚供人工補寫；下次重試
    // 會經由 GetIssue 冪等路徑再拿到同一組號碼重寫，可自癒
    Sentry.captureMessage(
      "issueInvoiceForOrder: ECPay 開立成功但本地寫入失敗",
      {
        level: "error",
        extra: { orderId, invoiceNo, updateError },
      },
    );
    return {
      ok: false,
      error: `發票已開立（${invoiceNo}）但寫入失敗，請重試或人工補登`,
    };
  }
  if (!updated || updated.length === 0) {
    // CAS 沒命中＝另一個並發呼叫已搶先寫入。若對方寫入的是空號碼（歷史
    // duplicate 路徑）而我們手上有真號碼，補填之；.is('invoice_no', null)
    // 確保不覆蓋對方已寫入的完整資料
    const { error: backfillError } = await serviceRole
      .from("orders")
      .update({ invoice_no: invoiceNo, invoice_meta: nextMeta })
      .eq("id", orderId)
      .is("invoice_no", null);
    if (backfillError) {
      Sentry.captureMessage("issueInvoiceForOrder: CAS 未命中且補填失敗", {
        level: "warning",
        extra: { orderId, invoiceNo, backfillError },
      });
    }
  }

  return { ok: true, invoiceNo, alreadyIssued: false };
}
