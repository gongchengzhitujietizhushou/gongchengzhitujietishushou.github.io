# 工程制图解题助手

一个 **纯静态、纯前端** 的工程制图解题助手网站：用户上传题目图片（png / jpg），
浏览器内自动完成 **图像识别 → 工程制图求解 → 渲染答案图**，
像主流 AI 聊天网站一样展示历史记录（存于浏览器 localStorage + IndexedDB）。

**无后端、无登录、无服务器** —— 所有视觉/求解/渲染逻辑均为浏览器 JavaScript。

技术栈：**Vue 3 (全局构建) + Canvas 2D (图像处理 & 答案渲染) + localStorage/IndexedDB**。

---

## 快速开始

直接打开 `index.html` 或用任意静态服务器托管：

```bash
# 在项目根目录启动静态服务器
python3 -m http.server 8765
```

打开 <http://127.0.0.1:8765/> ，上传一张工程图图片即可。

> 图片要求：包含 **主视图（矩形 + 三角孔口）** 与 **左视图（圆 + 两条虚线弦）** 的
> "圆柱上开通前后贯通楔形孔" 题（5-2 求作俯视图）。
>
> 支持 png / jpg / jpeg / webp / bmp。**XCF 不支持** —— 若为 GIMP 的 XCF 格式，
> 请先在 GIMP 中 **"导出为 PNG"** 再上传。

## 功能

| 功能 | 说明 |
|---|---|
| 上传题目 | png / jpg / webp / bmp；拖拽或点击选择；XCF 给出导出 PNG 提示 |
| 图像预处理 | 灰度 → 锐化(unsharp) → 自适应二值化 → 形态学去噪（纯 JS/Canvas） |
| 参数提取 | 圆检测(Hough 移植) + 矩形/三角形轮廓 + 虚线弦对称聚类（纯 JS） |
| 求解算法 | 圆柱+楔形孔题型：由主视图(矩形+三角)、左视图(圆+虚线弦) 求俯视图"束腰" |
| 答案渲染 | Canvas 2D 绘制 三视图，俯视图为所求（黑色加粗） |
| 历史记录 | localStorage 索引 + IndexedDB 存原图；点击回看、删除、清空 |
| 设置 | LLM API Key / 模型 / 广告代码（预留，存 localStorage） |

## 目录结构

```
.
├── index.html              # 入口 (Vue 挂载, 广告位, 设置弹窗)
├── css/
│   └── style.css           # 全部样式
└── js/
    ├── vision.js           # 图像处理 + 参数提取 (纯 Canvas/JS, 无 WASM)
    ├── solver.js           # 工程制图求解算法 (port of core/solver.py)
    ├── render.js           # 答案图渲染 (Canvas 2D, port of core/renderer.py)
    ├── storage.js          # localStorage 历史/设置 + IndexedDB 图片
    ├── app.js              # Vue 3 应用 (聊天式界面)
    └── vendor/
        └── vue.global.prod.js   # Vue 3.4.38 (vendored; 亦可由 dev-javascript/vue 安装)
```

## 解题算法（示例题型）

识别到的典型题型为 **5-2 求作俯视图**：轴线水平的圆柱上开一个前后贯通的楔形孔。

- 主视图：矩形（圆柱）+ 三角形（孔口），量得 长度 L、孔尖 X1、孔底 X2、孔口半高 A
- 左视图：圆（半径 R）+ 两条水平虚线弦（孔底平面棱边投影）
- 俯视图（所求）：圆柱前后被孔切断 → 轮廓向内收缩，形成两条 **椭圆弧"束腰"**
  `z = ±√(R² − (K(x−X1))²)`；孔底平面为虚线；孔尖为虚线。

关键尺寸满足 `R : A : W = 5 : 4 : 3`（`W = √(R²−A²)`），由 3-4-5 关系自动校验。

## 说明

- 处理全部在浏览器内完成（约 1~3 秒），无需联网、无服务器依赖。
- 图像检测为 OpenCV `HoughCircles` / `findContours` 的忠实 JS 移植，无需 10MB WASM。
- 设置面板可填入 LLM API Key 与广告代码（均存于 localStorage），为未来扩展预留；
  广告代码为 HTML，会显示在页面顶部广告位。
- 打包：JS 库（Vue）遵循 `dev-javascript/vue` ebuild（SLOT=3）；
  站点本身提供 `www-apps/gongchengzhitujietizhushou` (9999 live) ebuild。
