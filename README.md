# dsh-media 1.3.0

Tạo/sửa ảnh mặc định bằng **cx/gpt-image-2.5** qua TLPRO. Có thể chọn
**gemini-3.1-flash-image**. TTS tiếng Việt và các giọng x.ai vẫn được giữ.

## Công cụ

- `create_image`: prompt, model, n (1–10), aspect_ratio; GPT có size/quality,
  Gemini có resolution 512/1K/2K/4K.
- `edit_image`: cùng tham số trên, thêm image_url HTTPS. Ảnh /media/ của chính
  website được đọc từ ổ đĩa và gửi base64/data URL để không vướng đăng nhập.
- `speak`: text tối đa 60.000 ký tự, voice mặc định eve, language mặc định en;
  dùng vi cho tiếng Việt.

GPT nhận size auto/1024x1024/1536x1024/1024x1536; quality auto/low/medium/high.
Khi không truyền size, tỉ lệ ngang ánh xạ sang 1536x1024, dọc sang 1024x1536,
vuông sang 1024x1024. Đây là kích thước API GPT hỗ trợ, không phải 9:16 chính xác.
Gemini nhận nguyên aspect_ratio, resolution mặc định của nhà cung cấp là 1K.

Ảnh gọi `POST /llmtlpro/v1/images/generations` hoặc `/images/edits` trên
hoantienmuasam.net với biến môi trường `TLPRO_API_KEY`.
TTS gọi `POST https://api.x.ai/v1/tts` với `XAI_API_KEY`.
Không ghi khóa API vào cấu hình hoặc Git.

Tạo/sửa ảnh x.ai và công cụ tạo video x.ai đã được gỡ. Ảnh, video, audio đã lưu
vẫn xem và tải được. `client.js` hiển thị trình phát và nút tải file; package
phải khai báo `exports["./client"]` và `dsh.client` để DSH nạp phần giao diện.

## Cài vào DSH

Thêm dsh-media vào `dsh.profile.bundles`, rồi cấu hình profile:

```yaml
- id: dsh-media
  config:
    publicOrigin: https://dsh.hoantienmuasam.net
    mediaDir: /data/.dsh/state/superagent/media
```

File phục vụ tại /media/<tệp>, thêm ?download=1 để tải. Có HEAD và Range
(206); video cũ còn trang /media/watch/<tệp>.

## Kiểm thử

`npm test` chạy các kiểm thử API giả lập, không tạo media có tính phí.
