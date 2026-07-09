-- T70: check-then-insert 併發加車（雙擊、雙分頁）會讓同一 guest_token 產生兩筆
-- cart row，導致後續所有 .maybeSingle() 查詢（read-cart.ts／get-cart-count.ts／
-- checkout createOrder）炸多列錯誤，購物車看似「消失」。
-- 會員 cart 的 guest_token 為 NULL，比照既有 uq_payment_one_paid_per_order 的
-- partial unique index 寫法，只約束非 NULL 列。
create unique index uq_cart_guest_token
  on public.cart (guest_token)
  where (guest_token is not null);

comment on index public.uq_cart_guest_token is
  'T70：同一 guest_token 至多一筆 cart，避免併發 addToCart 造成重複購物車；配合 addToCart 改為 insert-then-23505-retry。';
