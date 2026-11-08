// ============================================================
// js/acard_left_view.js
// 答案卡: 求作左视图 (category: left_view)
// ------------------------------------------------------------
// 圆柱 + 楔形孔立体, 已知主视图、俯视图, 求作左视图。
// 复用 js/acard_solid.js 共享构建器 (target='left')。
// ============================================================
'use strict';

(function () {
  const CAT = 'left_view';
  const TARGET = 'left';

  const DEF = {
    id: CAT,
    title: '求作左视图',
    description: '轴线水平的圆柱，主视图为矩形内一个三角形孔口，俯视图反映孔口与孔底的投影关系；圆柱上开有前后贯通的楔形孔，求作左视图。',
    dataSchema: '{"R":圆柱半径,"L":圆柱长度,"X1":三角形尖点距左端距离,"X2":孔底平面距左端距离,"A":孔口半高}；建议令 R=100，须满足 0<X1<X2<L、0<A<R。',
    normalize: function (data) { return ACardSolid.normalize(data); },
    mount: function (host, data, meta) { return ACardSolid.mountSolidCard(host, data, meta, TARGET); },
  };

  if (typeof AnswerCards !== 'undefined') AnswerCards.register(CAT, DEF);
  if (typeof module !== 'undefined' && module.exports) module.exports = { DEF: DEF };
})();
