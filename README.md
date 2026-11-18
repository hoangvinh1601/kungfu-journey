# Kungfu Journey 功夫

Nền tảng học võ trên web: học với võ sư 3D, luyện tập có camera AI chấm tư thế, và một mạng xã hội riêng cho người tập võ.

**Demo:** https://hoangvinh1601.github.io/kungfu-journey/

## Giai đoạn 1 (đang chạy)

- **Tài khoản:** đăng ký / đăng nhập / đăng xuất bằng email, quên mật khẩu, hồ sơ cá nhân (ảnh, tên, giới thiệu).
- **Cộng đồng:** bảng tin kiểu mạng xã hội, đăng bài theo chủ đề võ thuật (kỹ thuật, buổi tập, hỏi đáp, bài giảng, thi đấu, sự kiện), ảnh/video, thích, bình luận, chia sẻ, theo dõi, báo cáo. Bài bị 3 người báo cáo tự ẩn chờ duyệt.
- **Võ sư:** nộp ảnh bằng cấp, ban quản trị duyệt → huy hiệu "Võ sư", được đăng bài giảng và bài tập (Studio). Học viên không đăng được bài giảng (chặn ở cả giao diện lẫn máy chủ).
- **Độ thuần thục:** mỗi thức giữ đúng 5 giây hoặc làm đúng 3 lần là thuần thục; lưu theo tài khoản, hiện trên trang cá nhân.
- **Quay video buổi tập:** quay camera kèm viền, bàn tay hướng dẫn và điểm xanh (tối đa 30 giây), đăng thẳng lên cộng đồng.
- **Quản trị:** duyệt hồ sơ võ sư, xử lý bài bị báo cáo.

## Giai đoạn 2

- **Tin nhắn:** chat 1–1 với võ sư (nút “Liên hệ võ sư” trên trang cá nhân hoặc “Hỏi võ sư” trong bài của võ sư), báo tin mới.
- **Gọi video:** gọi trực tiếp trong trang tin nhắn, có chuông báo cuộc gọi đến, tắt/mở micro và camera.
- **Tập chung:** hai người cùng một bài, màn hình chia đôi, thấy camera và điểm của nhau. Chủ phòng chọn thức, người kia tự theo.
- **Thi đấu:** cả hai tập cả bài cùng lúc, ai điểm cao hơn thắng; kết quả lưu lại và đăng được lên cộng đồng.
- **Hẹn tập:** tạo phòng có giờ hẹn, gửi link hoặc mời thẳng trong tin nhắn.

Video đi trực tiếp giữa hai máy (WebRTC). Nếu hai bên ở sau mạng công ty chặn kết nối, cần thêm máy chủ TURN: đặt `VITE_TURN_URL`, `VITE_TURN_USER`, `VITE_TURN_PASS` trong `app/.env` rồi build lại.

## Cấu trúc

- `app/`: mã nguồn (Vite + React). `app/src/engine/` là engine luyện tập (MediaPipe, three.js, chấm điểm, studio).
- `supabase/schema.sql`, `supabase/phase2.sql`: cơ sở dữ liệu, phân quyền (RLS), kho lưu trữ, kênh realtime riêng tư. Chạy lần lượt trong Supabase → SQL Editor.
- `index.html`, `assets/`: bản build cho GitHub Pages (`cd app && npm install && npm run build`).
- `models/`, `blender/`: nhân vật 3D và script dựng nhân vật.

## Nhân vật 3D

| Nhân vật | Nguồn |
|---|---|
| Sư phụ Kungfu, Võ sư Vovinam, Nữ võ sinh, Võ sinh Karate | Người thật dựng bằng MakeHuman / MPFB2 trong Blender, tài nguyên CC0. Script ở `blender/make_humans.py` |
| Michelle, X Bot, Soldier | Nhân vật Mixamo (Adobe) lấy từ kho mẫu của three.js, tải qua CDN |

Khung xương đặt tên chuẩn Mixamo (`mixamorig:Hips`, `LeftArm`…). Bạn có thể nạp nhân vật `.glb` của riêng mình bằng nút **Tải .glb** trong trang Học động tác.

### Dựng lại nhân vật

1. `pip install bpy` (Blender 5.x, Python 3.13)
2. Cài extension MPFB2 từ [extensions.blender.org](https://extensions.blender.org/add-ons/mpfb/)
3. Tải gói **MakeHuman system assets** và **skins01/02** (CC0) từ [makehumancommunity.org](https://static.makehumancommunity.org/assets/assetpacks.html), giải nén vào thư mục dữ liệu của MPFB
4. `python3 blender/make_humans.py models` (hoặc thêm tên nhân vật, ví dụ `su_phu`)

Muốn thêm nhân vật mới, sửa bảng `HUMANS` trong script: giới tính, tuổi, cơ bắp, chủng tộc, da, tóc, quần áo, màu nhuộm, đai.

## Chạy trên máy

```bash
python3 -m http.server 8000
# mở http://localhost:8000
```

Camera chỉ hoạt động trên `https` hoặc `localhost`.

## Công nghệ

- [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) (`@mediapipe/tasks-vision`): 33 điểm khớp 2D và 3D
- [three.js](https://threejs.org) r160: hiển thị và điều khiển khung xương nhân vật
- Blender (`bpy`): dựng nhân vật

Toàn bộ xử lý camera chạy trên máy người dùng, không gửi hình ảnh đi đâu.
