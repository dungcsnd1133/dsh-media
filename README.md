# dsh-media

Bộ công cụ DeepSeek Harness. Phiên chat gọi xAI Imagine và Voice, rồi lưu file để mở trên trang.

Cần biến môi trường `XAI_API_KEY`.

| Công cụ | Việc làm |
|---|---|
| `speak` | Đọc chữ thành giọng nói. Giọng: eve, ara, rex, sal, leo. Tiếng Việt dùng `language: vi`. |
| `create_image` | Tạo ảnh từ mô tả. |
| `edit_image` | Sửa ảnh có sẵn theo lời dặn. |
| `create_video` | Tạo video từ chữ, hoặc từ một ảnh. Dài 6, 10 hoặc 15 giây. |

## Cấu hình

Thêm bundle `dsh-media`, rồi phủ lên trong `cordis.patch.yml` của profile:

```yaml
- id: dsh-media
  config:
    publicOrigin: https://example.com
    mediaDir: /var/lib/dsh/media
```

`publicOrigin` là địa chỉ trang public. `mediaDir` là thư mục lưu file trên máy. Ảnh, tiếng và video được phục vụ tại `/media/<tệp>`.
