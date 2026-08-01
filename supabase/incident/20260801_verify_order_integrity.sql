-- Read-only verification report. Safe before and after the hotfix migration.

with order_counts as (
  select
    order_record.id::text as order_id,
    order_record.order_no,
    order_record.customer_name,
    order_record.supplier_name,
    order_record.project,
    order_record.order_date,
    order_record.updated_at,
    count(row_record.id) as current_row_count,
    coalesce(sum(row_record.quantity), 0) as total_pieces,
    coalesce(sum(row_record.area_m2), 0) as total_area_m2
  from public.glass_orders as order_record
  left join public.glass_order_rows as row_record
    on row_record.order_id = order_record.id
  group by order_record.id, order_record.order_no, order_record.customer_name,
    order_record.supplier_name, order_record.project, order_record.order_date,
    order_record.updated_at
)
select *
from order_counts
order by order_no;

select
  order_record.id::text as order_id,
  order_record.order_no,
  count(row_record.id) as row_count,
  coalesce(sum(row_record.quantity), 0) as total_pieces,
  coalesce(sum(row_record.area_m2), 0) as total_area_m2,
  array_agg(row_record.id::text order by row_record.line_no, row_record.id) as row_ids
from public.glass_orders as order_record
join public.glass_order_rows as row_record on row_record.order_id = order_record.id
where order_record.order_no = 'GO-001289'
group by order_record.id, order_record.order_no;

select
  (select count(*) from public.glass_orders) as total_orders,
  (select count(*) from public.glass_order_rows) as total_order_rows,
  (select count(*) from public.glass_orders as order_record
    where not exists (
      select 1 from public.glass_order_rows as row_record
      where row_record.order_id = order_record.id
    )) as orders_without_rows,
  (select count(*) from (
    select order_id from public.glass_order_rows group by order_id having count(*) = 1
  ) as one_row_orders) as one_row_orders,
  (select count(*) from (
    select order_id from public.glass_order_rows group by order_id having count(*) > 1
  ) as multi_row_orders) as multi_row_orders;
