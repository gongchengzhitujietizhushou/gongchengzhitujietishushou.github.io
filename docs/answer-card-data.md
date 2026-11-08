# 答案卡（Answer Card）数据说明

工程制图解题助手按**视图构造任务**组织题型（category）。每个题型对应一个独立的答案卡模块 `js/acard_xxx.js`，由一段**通用输入 JSON** 驱动渲染。LLM 返回 `{ mode: "card", category, data, ... }` 时，前端用 `data` 填充对应题型的答案卡。

## 通用答案卡 JSON（data）

答案卡是**数据驱动**的：一段 JSON 同时描述**尺寸参数**、**如何画三维场景**、以及**如何画结果图（含坐标）**。渲染代码（`js/acard_base.js` + `js/render.js`）读取这段 JSON 来画 3D 场景与答案图。

```json
{
  "params": { "R": 50, "L": 130, "X1": 20, "X2": 104, "A": 40 },
  "scene":  { "solid": "cylinder_wedge_hole" },
  "answer": {
    "view":  "top",
    "views": {
      "front": [ { "type": "line", "kind": "visible", "a": [0, 0], "b": [130, 0] } ],
      "left":  [ { "type": "circle", "kind": "visible", "c": [0, 0], "r": 50 } ],
      "top":   [ { "type": "poly", "kind": "visible", "pts": [[0, 0], [130, 0]] } ]
    },
    "labels": { "front": "主视图", "left": "左视图", "top": "俯视图" },
    "dims":   [ "D=2R=100", "L=130" ]
  }
}
```

### `params` — 尺寸参数（任意命名）

立体的尺寸。由对应立体的 `normalizeParams(params)` 校验。字段可任意，不限于某个题型。

### `scene` — 如何画三维场景

```json
{ "solid": "cylinder_wedge_hole" }
```

`solid` 是**立体注册表**（`ACardBase.solids`）中的键。渲染器按 `scene.solid` 找到对应构建器（`solid.build(THREE, stage, params)`）来搭三维场景。新立体用 `ACardBase.registerSolid(name, def)` 注册即可，答案卡代码无需改动。

### `answer` — 如何画结果图（含坐标）

```json
{
  "view":  "top",
  "views": { "front": [prims], "left": [prims], "top": [prims] },
  "labels": { "front": "主视图", "left": "左视图", "top": "俯视图" },
  "dims": [ "尺寸标注…" ]
}
```

- `view`：所求视图（`top` / `left` / `front`），该视图以黑、加粗绘制并标【所求 · 答案】。
- `views`：各视图的**图元坐标**（各自局部坐标）。图元：
  - `{ "type":"line", "kind":"visible|hidden|center", "a":[x,y], "b":[x,y] }`
  - `{ "type":"poly", "kind":"visible|hidden|center", "pts":[[x,y],…] }`
  - `{ "type":"circle", "kind":"visible|hidden|center", "c":[x,y], "r":r }`
- `views` 可省略：渲染器用立体的**标准三维边线模型**投影得到（`solid.edges3d(params)` → `ACardBase.project3dToViews`，见下节），与 `Solver.solve` 的三视图一致。
- `labels` / `dims` 可省略，`labels` 默认 主视图/左视图/俯视图。

## 标准第三角投影与三维边线模型

答案卡按**标准工程制图（第三角投影）**由三维场景直接导出三视图，不依赖硬编码坐标。立体在注册时给出 **3D 边线模型** `edges3d(params)`，返回边线数组：

```js
// 每条边 e = { kind, pts:[[x,y,z],...], views?:{front?,left?,top?} }
//   kind: 'visible' | 'hidden' | 'center'
//   views: 指定该边出现在哪些视图及其线型; 省略则出现在全部视图 (用 kind)
{
  kind: 'visible',
  pts: [[x1,y1,z1], [x2,y2,z2], ...],
  views: { front: 'visible', top: 'visible' }   // 例如某边只在主/俯视绘制
}
```

`ACardBase.project3dToViews(edges)` 按标准方向投影到三个视图（坐标约定：`x` 沿轴线、`y` 竖直、`z` 深度）：

| 视图 | 看的方向 | 投影 |
| --- | --- | --- |
| 主视图 `front` | 沿 `-Z` 看 | `(x, y)` |
| 左视图 `left` | 沿 `+X` 看 | `(z, y)` |
| 俯视图 `top` | 沿 `-Y` 看 | `(x, z)` |

`edges3d` 给出立体的真实棱线、轮廓线与中心线（含可见/不可见/中心线类型与逐视图掩码），投影结果与 `Solver.solve` 的标准三视图完全一致。**`normalize()` 优先用 `project3dToViews(solid.edges3d(params))` 生成 `views`；`labels`/`dims` 仍来自 `solid.answer(params)`。**

### `cylinder_wedge_hole` 的边线

以 `{R,L,X1,X2,A}` 为例，`edges3d` 包含（`W=√(R²−A²)`，`K=A/(X2−X1)`）：

- 左右端面圆（x=0 / x=L）：主/俯视投影为竖直线段，左视投影为圆（近端可见）。
- 主视图轮廓：圆柱前后素线 `y=±R`（主视可见）。
- 俯视图轮廓：圆柱左右素线 `z=±R`，被束腰分成 `[0,X1]` 与 `[X2,L]` 两段（俯视可见）。
- 束腰椭圆弧：斜平面 `y=±K(x−X1)` ∩ 圆柱面，主/俯视可见（主视为三角形两条斜边，俯视为内收的束腰曲线）。
- 孔底平面 ∩ 圆柱面 圆弧（x=X2）：主视为三角形底边，俯视为 `|z|∈[W,R]` 竖直线段。
- 孔底平面上下棱边（弦 `y=±A`，x=X2）：左视可见虚线，俯视不可见虚线。
- 孔尖（x=X1，y=0，沿 z 贯穿）：俯视不可见虚线。
- 轴线中心线（主视 `y=0`、俯视 `z=0`）；左视十字中心线。

## 分类总览

| category | 任务 | 答案卡模块 | 所求视图 |
| --- | --- | --- | --- |
| `top_view` | 求作俯视图 | `js/acard_top_view.js` | `top` |
| `left_view` | 求作左视图 | `js/acard_left_view.js` | `left` |
| `front_view` | 求作主视图 | `js/acard_front_view.js` | `front` |

三个题型共用同一立体（`cylinder_wedge_hole`，轴线水平的圆柱 + 前后贯通楔形孔），由 `js/solid_cylinder_wedge_hole.js` 注册；区别仅在 `answer.view`（所求视图）。

> 旧历史记录中的 `cylinder_wedge_hole` 自动映射为 `top_view`；旧扁平 `{ R,L,X1,X2,A }` 数据也会被包装为通用格式。

## 各题型输入 JSON

### `top_view` — 求作俯视图

```json
{
  "params": { "R": 50, "L": 130, "X1": 20, "X2": 104, "A": 40 },
  "scene":  { "solid": "cylinder_wedge_hole" },
  "answer": { "view": "top" }
}
```

### `left_view` — 求作左视图

```json
{
  "params": { "R": 50, "L": 130, "X1": 20, "X2": 104, "A": 40 },
  "scene":  { "solid": "cylinder_wedge_hole" },
  "answer": { "view": "left" }
}
```

### `front_view` — 求作主视图

```json
{
  "params": { "R": 50, "L": 130, "X1": 20, "X2": 104, "A": 40 },
  "scene":  { "solid": "cylinder_wedge_hole" },
  "answer": { "view": "front" }
}
```

### `params` 字段（`cylinder_wedge_hole`）

| 字段 | 含义 | 约束 |
| --- | --- | --- |
| `R` | 圆柱半径 | `R > 0` |
| `L` | 圆柱长度 | `L > 0` |
| `X1` | 楔形孔尖点（三角形顶点）距左端距离 | `0 ≤ X1 < X2` |
| `X2` | 楔形孔底平面距左端距离 | `X1 < X2 ≤ L` |
| `A` | 楔形孔口半高 | `0 < A < R` |

单位任意但需同比例（建议令 `R = 100`）；缺失或非法时 `normalize()` 返回 `null`，卡片显示"数据无效"。

## 完整 LLM 卡片返回示例

```json
{
  "mode": "card",
  "category": "top_view",
  "title": "求作俯视图",
  "confidence": 0.9,
  "data": {
    "params": { "R": 50, "L": 130, "X1": 20, "X2": 104, "A": 40 },
    "scene":  { "solid": "cylinder_wedge_hole" },
    "answer": { "view": "top" }
  },
  "analysis": "1. 圆柱轴线水平，主视图为矩形，左视图为圆。\n2. 楔形孔前后贯通……",
  "notes": ["注意孔口三角形与孔底平面的投影关系。"]
}
```

- `mode` 固定为 `"card"`（纯文字时为 `"text"`）。
- `category` 必须取自上表；否则前端降级为文字说明。
- `data` 按通用 JSON 校验（`params` + `scene.solid` + `answer.view`），非法时降级为文字说明。
- `analysis` / `notes` 可选，用于展示解题过程与备注。

## 如何新增一个立体 / 题型

1. **新增立体**：`js/solid_<name>.js`，调用 `ACardBase.registerSolid('<name>', { title, normalizeParams, paramFields, build, answer, edges3d })`；在 `index.html` 中于 `acard_base.js` 之后引入。`edges3d(params)` 给出标准 3D 边线模型（见上节），省略时 `answer(params)` 需直接给出 `views`。
2. **新增题型**：`js/acard_<category>.js`，`AnswerCards.register('<category>', { title, description, dataSchema, normalize, mount })`；`mount` 调 `ACardBase.mountCard(host, data, meta, { defaultView, defaultSolid, title })`。
3. `normalize(data)` 校验并规范化通用 JSON，非法返回 `null`。
4. `mount(host, data, meta)` 渲染答案卡，返回 `{ destroy() }` 用于卸载。
5. 在本文档补充分类条目与 `params` 字段表。
