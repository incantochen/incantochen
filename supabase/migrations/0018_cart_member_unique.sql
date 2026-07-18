-- T81: 登入併車（mergeGuestCartOnLogin／claimGuestCartForMember／
-- getOrCreateMemberCart）全走條件式 UPDATE／INSERT-then-23505-retry，但
-- check-then-act 在並發下（同一會員兩裝置近乎同時登入）仍可能各自查無
-- 會員車、各自 INSERT 出兩筆 cart，DB 約束才是真防線（同 T70 修
-- uq_cart_guest_token 的教訓）。member 為 NULL 的訪客車不受影響。
create unique index uq_cart_member
  on public.cart (member_id)
  where (member_id is not null);

comment on index public.uq_cart_member is
  'T81：同一 member 至多一筆 cart，避免併發登入併車造成重複購物車；配合 get-or-create-member-cart.ts 的 insert-then-23505-retry。';
