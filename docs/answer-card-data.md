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
- `views` 可省略：渲染器会用该立体的 `answer(params)` 自动计算坐标（`solid.answer(params).views`）。
- `labels` / `dims` 可省略，`labels` 默认 主视图/左视图/俯视图。

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

1. **新增立体**：`js/solid_<name>.js`，调用 `ACardBase.registerSolid('<name>', { title, normalizeParams, paramFields, build, answer })`；在 `index.html` 中于 `acard_base.js` 之后引入。
2. **新增题型**：`js/acard_<category>.js`，`AnswerCards.register('<category>', { title, description, dataSchema, normalize, mount })`；`mount` 调 `ACardBase.mountCard(host, data, meta, { defaultView, defaultSolid, title })`。
3. `normalize(data)` 校验并规范化通用 JSON，非法返回 `null`。
4. `mount(host, data, meta)` 渲染答案卡，返回 `{ destroy() }` 用于卸载。
5. 在本文档补充分类条目与 `params` 字段表。
