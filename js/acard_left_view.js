// ============================================================
// js/acard_left_view.js
// 答案卡: 求作左视图 (category: left_view)
// ------------------------------------------------------------
// 圆柱 + 楔形孔立体, 已知主视图、俯视图, 求作左视图。
// 复用 js/acard_base.js 通用答案卡 (scene.solid=cylinder_wedge_hole, view=left)。
// ============================================================
'use strict';

(function () {
  const CAT = 'left_view';
  const VIEW = 'left';

  const DEF = {
    id: CAT,
    title: '求作左视图',
    description: '轴线水平的圆柱，主视图为矩形内一个三角形孔口，俯视图反映孔口与孔底的投影关系；圆柱上开有前后贯通的楔形孔，求作左视图。',
    dataSchema: '{"params":{...尺寸...},"scene":{"solid":"cylinder_wedge_hole"},"answer":{"view":"left"}}；params 含 R/L/X1/X2/A，建议令 R=100，须满足 0<X1<X2<L、0<A<R。',
    normalize: function (data) { return ACardBase.normalize(data, { defaultView: VIEW, defaultSolid: 'cylinder_wedge_hole' }); },
    mount: function (host, data, meta) { return ACardBase.mountCard(host, data, meta, { defaultView: VIEW, defaultSolid: 'cylinder_wedge_hole', title: '求作左视图' }); },
  };

  if (typeof AnswerCards !== 'undefined') AnswerCards.register(CAT, DEF);
  if (typeof module !== 'undefined' && module.exports) module.exports = { DEF: DEF };
})();
