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
| Võ sinh Vovinam, Tăng nhân Thiếu Lâm, Nữ hiệp, Mộc nhân | Tự dựng bằng Blender, script ở `blender/make_characters.py` |
| Michelle, X Bot, Soldier | Nhân vật Mixamo (Adobe) lấy từ kho mẫu của three.js, tải qua CDN |

Khung xương đặt tên chuẩn Mixamo (`mixamorig:Hips`, `LeftArm`…). Bạn có thể nạp nhân vật `.glb` của riêng mình bằng nút **Tải .glb** trong trang Học động tác.

Dựng lại hoặc chỉnh nhân vật (cần Python 3.13):

```bash
pip install bpy
python3 blender/make_characters.py models
```

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
