# dsh-media

Bộ công cụ DeepSeek Harness. Phiên Standard gọi API Grok rồi lưu file để mở trên trang.

Đã gắn vào profile `superagent` của máy này. Cần biến môi trường `XAI_API_KEY`.

## Công cụ

Thông số dưới đây là phần thân JSON gửi lên API, không phải thông số giao diện Grok.

### `speak`

`POST https://api.x.ai/v1/tts` → file `audio/mpeg`.

| Tham số tool | Trường API | Giá trị |
|---|---|---|
| `text` | `text` | Bắt buộc. Tối đa 60 000 ký tự. |
| `voice` | `voice_id` | Mặc định `eve`. Giọng có sẵn: eve, ara, rex, sal, leo, carina, zagan, helix, orion, luna, iris, altair, zenith, perseus, helios, lux, kepler, rigel, cosmo, celeste, ursa, sirius, lumen, castor, naksh, atlas, aurora, liora. Hoặc `voice_id` tùy chỉnh 8 ký tự. |
| `language` | `language` | Mặc định `en`. `auto`, `en`, `vi`, `zh`, `ja`, `ko`, `fr`, `de`, `hi`, `id`, `it`, `ru`, `tr`, `bn`, `pt-BR`, `pt-PT`, `es-MX`, `es-ES`, `ar-EG`, `ar-SA`, `ar-AE`. Tiếng Việt là `vi`. |

### `create_image`

`POST https://api.x.ai/v1/images/generations`

| Tham số tool | Trường API | Giá trị |
|---|---|---|
| — | `model` | `grok-imagine-image-2.0` |
| `prompt` | `prompt` | Bắt buộc. |
| `n` | `n` | Số ảnh, từ 1 đến 10. Mặc định 1. |
| `aspect_ratio` | `aspect_ratio` | Không bắt buộc. `1:1`, `3:4`, `4:3`, `9:16`, `16:9`, `2:3`, `3:2`, `9:19.5`, `19.5:9`, `9:20`, `20:9`, `1:2`, `2:1`, `21:9`, `5:2`, `auto`. Bỏ trống thì API tự chọn. |
| `resolution` | `resolution` | Không bắt buộc. `1k`, `1.5k`, `2k`. Bỏ trống thì API dùng `1k`. |
| — | `response_format` | `url` |

### `edit_image`

`POST https://api.x.ai/v1/images/edits`

| Tham số tool | Trường API | Giá trị |
|---|---|---|
| — | `model` | `grok-imagine-image-2.0` |
| `prompt` | `prompt` | Bắt buộc. Cách sửa ảnh. |
| `image_url` | `image.url` | URL `https` của ảnh. `image.type` luôn là `image_url`. |
| `resolution` | `resolution` | Không bắt buộc. `1k`, `1.5k`, `2k`. Bỏ trống thì API dùng `1k`. |
| `aspect_ratio` | `aspect_ratio` | Không bắt buộc. Cùng danh sách với `create_image`, gồm `9:16`. Bỏ trống thì giữ tỉ lệ ảnh gốc. |

### `create_video`

`POST https://api.x.ai/v1/videos/generations`, rồi `GET https://api.x.ai/v1/videos/{request_id}` đến khi `status` là `done`.

| Tham số tool | Trường API | Giá trị |
|---|---|---|
| — | `model` | `grok-imagine-video-1.5` |
| `prompt` | `prompt` | Bắt buộc. |
| `image_url` | `image.url` | Không bắt buộc. Bỏ trống thì tạo video từ chữ. Có URL thì tạo video từ ảnh đó. |
| `duration` | `duration` | Số nguyên từ 1 đến 15 giây. Mặc định 6. |
| `aspect_ratio` | `aspect_ratio` | Chỉ khi tạo từ chữ. `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3`, `21:9`, `5:2`. Video từ ảnh giữ tỉ lệ ảnh gốc. |
| `resolution` | `resolution` | Không bắt buộc. `480p`, `720p`, `1080p`. Bỏ trống thì API dùng `480p`. |

Khi xong, URL nằm ở `video.url`.

## Cài vào DSH

Thêm `dsh-media` vào `dsh.profile.bundles`, rồi phủ cấu hình trong `cordis.patch.yml` của profile:

```yaml
- id: dsh-media
  config:
    publicOrigin: https://example.com
    mediaDir: /var/lib/dsh/media
```

`publicOrigin` là địa chỉ trang public. `mediaDir` là thư mục lưu file. Trang phục vụ file tại `/media/<tệp>`.

Trên máy đang chạy:

```yaml
- id: dsh-media
  config:
    publicOrigin: https://agent.hoantienmuasam.net
    mediaDir: /dsh/home/state/superagent/media
```

## Trên trang chat

`client.js` đổi link `/media/...mp3` thành thanh nghe, link video thành khung xem, và thêm icon tải ở hàng nút dưới tin nhắn. File video và audio vẫn tải được bằng `?download=1`.
