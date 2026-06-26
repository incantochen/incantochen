-- T23: checkout form collects zipCode; logistics API (T48) will need it as a separate field
ALTER TABLE public.orders ADD COLUMN zip_code text;
