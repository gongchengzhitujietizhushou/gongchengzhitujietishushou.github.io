// ============================================================
// js/acard_top_view.js
// 答案卡: 求作俯视图 (category: top_view)
// ------------------------------------------------------------
// 圆柱 + 楔形孔立体, 已知主视图、左视图, 求作俯视图。
// 复用 js/acard_base.js 通用答案卡 (scene.solid=cylinder_wedge_hole, view=top)。
// ============================================================
'use strict';

(function () {
  const CAT = 'top_view';
  const VIEW = 'top';

  const DEF = {
    id: CAT,
    title: '求作俯视图',
    description: '轴线水平的圆柱，主视图为矩形内一个三角形孔口，左视图为圆内两条水平虚线弦；圆柱上开有前后贯通的楔形孔，求作俯视图。',
    dataSchema: '{"params":{...尺寸...},"scene":{"solid":"cylinder_wedge_hole"},"answer":{"view":"top"}}；params 含 R/L/X1/X2/A，建议令 R=100，须满足 0<X1<X2<L、0<A<R。',
    normalize: function (data) { return ACardBase.normalize(data, { defaultView: VIEW, defaultSolid: 'cylinder_wedge_hole' }); },
    mount: function (host, data, meta) { return ACardBase.mountCard(host, data, meta, { defaultView: VIEW, defaultSolid: 'cylinder_wedge_hole', title: '求作俯视图' }); },
  };

  if (typeof AnswerCards !== 'undefined') AnswerCards.register(CAT, DEF);
  if (typeof module !== 'undefined' && module.exports) module.exports = { DEF: DEF };
})();
