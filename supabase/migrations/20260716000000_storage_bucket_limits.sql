-- Fase 5 security audit finding: none of the three Storage buckets
-- (avatars, product-thumbnails, product-files) had a file_size_limit or
-- allowed_mime_types configured. For the two PUBLIC buckets this is a real
-- stored-XSS vector: nothing stopped a user uploading an SVG (or any other
-- file) as their "avatar" or a product "thumbnail" -- image/svg+xml can
-- embed <script>, and getPublicUrl() serves it back with no transformation,
-- so opening that URL directly executes the script in the storage domain's
-- origin. Client-side <input accept="image/*"> is not a security boundary
-- (trivially bypassed, and image/* doesn't exclude svg+xml anyway).
--
-- product-files is private (buyer/seller-only via RLS, no public read), so
-- the stored-XSS path doesn't apply the same way -- it only gets a size cap,
-- not a MIME allowlist, since it's a general marketplace deliverable bucket
-- (PDFs, zips, docs, videos, etc.) and an allowlist narrow enough to be
-- meaningful would also be narrow enough to break legitimate sellers.

UPDATE storage.buckets
SET file_size_limit = 5242880, -- 5 MiB
    allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
WHERE id = 'avatars';

UPDATE storage.buckets
SET file_size_limit = 5242880, -- 5 MiB
    allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
WHERE id = 'product-thumbnails';

UPDATE storage.buckets
SET file_size_limit = 209715200 -- 200 MiB
WHERE id = 'product-files';
