# Kungfu Journey 功夫

App luyện võ trên trình duyệt. Học viên xem võ sư làm mẫu bằng nhân vật 3D xoay 360°, rồi bật camera. App theo dõi khung xương bằng MediaPipe, so với động tác chuẩn và chỉ ra lỗi tư thế.

**Demo:** https://hoangvinh1601.github.io/kungfu-journey/ (mở bằng Chrome hoặc Edge, cho phép camera)

## Tính năng

- **Học động tác:** nhân vật 3D có khung xương, xoay 360°, có các góc nhìn sẵn (chính diện, chéo, ngang, sau lưng, từ trên), chế độ "Tập sau lưng thầy", đánh dấu khớp trọng tâm và hiện khung xương.
- **Luyện từng động tác:** camera chấm điểm tư thế theo thời gian thực. Khớp đổi màu xanh, vàng, đỏ, có giọng nói nhắc sửa. Giữ đúng 1,5 giây để qua bước.
- **Luyện cả bài:** tập liên tục theo nhịp mẫu. App căn nhịp bằng DTW, chấm từng thức và chỉ ra thức yếu nhất.
- **Võ sư:** quay trực tiếp hoặc tải video lên. App tách khung xương 2D và 3D, gợi ý các bước tự động, lưu bài và xuất/nhập file JSON.

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
