// ============================================================
// js/acard_front_view.js
// 答案卡: 求作主视图 (category: front_view)
// ------------------------------------------------------------
// 圆柱 + 楔形孔立体, 已知左视图、俯视图, 求作主视图。
// 复用 js/acard_base.js 通用答案卡 (scene.solid=cylinder_wedge_hole, view=front)。
// ============================================================
'use strict';

(function () {
  const CAT = 'front_view';
  const VIEW = 'front';

  const DEF = {
    id: CAT,
    title: '求作主视图',
    description: '轴线水平的圆柱，左视图为圆内两条水平虚线弦，俯视图反映孔口与孔底的投影关系；圆柱上开有前后贯通的楔形孔，求作主视图。',
    dataSchema: '{"params":{...尺寸...},"scene":{"solid":"cylinder_wedge_hole"},"answer":{"view":"front"}}；params 含 R/L/X1/X2/A，建议令 R=100，须满足 0<X1<X2<L、0<A<R。',
    normalize: function (data) { return ACardBase.normalize(data, { defaultView: VIEW, defaultSolid: 'cylinder_wedge_hole' }); },
    mount: function (host, data, meta) { return ACardBase.mountCard(host, data, meta, { defaultView: VIEW, defaultSolid: 'cylinder_wedge_hole', title: '求作主视图' }); },
  };

  if (typeof AnswerCards !== 'undefined') AnswerCards.register(CAT, DEF);
  if (typeof module !== 'undefined' && module.exports) module.exports = { DEF: DEF };
})();
