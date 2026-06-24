-- CURE finance fix.
-- Run once in Supabase -> SQL Editor if saving transaction type "Долг" fails.

alter table public.finance_transactions
  drop constraint if exists finance_transactions_type_check;

alter table public.finance_transactions
  add constraint finance_transactions_type_check
  check (type in ('Доход', 'Долг', 'Расход', 'Возврат', 'Скидка', 'Коррекция'));
