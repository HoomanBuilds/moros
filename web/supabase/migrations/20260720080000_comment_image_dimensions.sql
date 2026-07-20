alter table comments drop constraint if exists comments_image_dimensions_valid;
alter table comments add constraint comments_image_dimensions_valid check (
  (image_path is null and image_width is null and image_height is null)
  or (
    image_path is not null
    and image_width between 1 and 8192
    and image_height between 1 and 8192
    and image_width::bigint * image_height::bigint <= 40000000
  )
);
