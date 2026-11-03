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
| — | `response_format` | `url` |

API này không nhận `aspect_ratio`, `resolution` hay `quality`.

### `edit_image`

`POST https://api.x.ai/v1/images/edits`

| Tham số tool | Trường API | Giá trị |
|---|---|---|
| — | `model` | `grok-imagine-image-2.0` |
| `prompt` | `prompt` | Bắt buộc. Cách sửa ảnh. |
| `image_url` | `image.url` | URL `https` của ảnh. `image.type` luôn là `image_url`. |

### `create_video`

`POST https://api.x.ai/v1/videos/generations`, rồi `GET https://api.x.ai/v1/videos/{request_id}` đến khi `status` là `done`.

| Tham số tool | Trường API | Giá trị |
|---|---|---|
| — | `model` | `grok-imagine-video-1.5` |
| `prompt` | `prompt` | Bắt buộc. |
| `image_url` | `image.url` | Không bắt buộc. Bỏ trống thì tạo video từ chữ. Có URL thì tạo video từ ảnh đó. |
| `duration` | `duration` | Số nguyên từ 1 đến 15 giây. Mặc định 6. |

API này không nhận `resolution`. Khi xong, URL nằm ở `video.url`.

## Cài vào DSH

Thêm `dsh-media` vào `dsh.profile.bundles`, rồi phủ cấu hình trong `cordis.patch.yml` của profile:

```yaml
- id: dsh-media
  config:
    publicOrigin: https://example.com
    mediaDir: /var/lib/dsh/media
```

`publicOrigin` là địa chỉ trang public. `mediaDir` là thư mục lưu file. Trang phục vụ file tại `/media/<tệp>`.

Trên máy này:

```yaml
- id: dsh-media
  config:
    publicOrigin: https://shadow-timber-willow-fire.grok.me
    mediaDir: /root/.dsh/state/superagent/media
```
