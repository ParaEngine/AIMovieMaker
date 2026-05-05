// =================== 影视配音秀 — HUD 四角管理器 ===================

/**
 * @typedef {Object} PlayerState
 * @property {number} mana
 * @property {number} maxMana
 * @property {number} hp
 * @property {number} maxHp
 * @property {number} gold
 * @property {number} combo
 * @property {number} maxCombo
 * @property {number} boost - 倍率
 */

/** 评分动作对法力/生命的影响 */
const TIER_EFFECTS = {
  //           [mana, hp]
  10: [5, 0],    // PERFECT
  9:  [4, 0],
  8:  [3, 0],    // GREAT
  7:  [2, 0],
  6:  [1, 0],    // GOOD
  5:  [0, 0],
  4:  [0, 0],
  3:  [-1, -2],  // OK
  2:  [-2, -4],
  1:  [-3, -6],
  0:  [-5, -10], // MISS
};

/** 金币奖励 */
const GOLD_REWARDS = {
  perfect: 10,    // 单词 PERFECT
  comboBonus: 50, // combo × 10 奖励
  sentencePass: 20,
};

export class HudManager {
  constructor() {
    /** @type {PlayerState} */
    this._state = {
      mana: 100,
      maxMana: 100,
      hp: 100,
      maxHp: 100,
      gold: 0,
      combo: 0,
      maxCombo: 0,
      boost: 1.0,
    };

    // DOM refs
    this._manaBar = document.getElementById('manaBar');
    this._manaValue = document.getElementById('manaValue');
    this._hpBar = document.getElementById('hpBar');
    this._hpValue = document.getElementById('hpValue');
    this._coinValue = document.getElementById('coinValue');
    this._comboHudValue = document.getElementById('comboHudValue');
    this._boostHudValue = document.getElementById('boostHudValue');
    this._questChapter = document.getElementById('questChapter');
    this._questDesc = document.getElementById('questDesc');
    this._questFill = document.getElementById('questFill');
    this._questCount = document.getElementById('questCount');

    this._hudPanels = document.querySelectorAll('.rps-hud-panel');
  }

  /**
   * 显示 HUD 面板
   */
  show() {
    this._hudPanels.forEach(p => p.classList.add('rps-hud-visible'));
    this._renderAll();
  }

  /**
   * 隐藏 HUD 面板
   */
  hide() {
    this._hudPanels.forEach(p => p.classList.remove('rps-hud-visible'));
  }

  /**
   * 重置所有状态到初始值
   */
  reset() {
    this._state.mana = this._state.maxMana;
    this._state.hp = this._state.maxHp;
    this._state.gold = 0;
    this._state.combo = 0;
    this._state.maxCombo = 0;
    this._state.boost = 1.0;
    this._renderAll();
  }

  /**
   * 设任务信息
   * @param {string} chapter
   * @param {string} desc
   * @param {number} current
   * @param {number} total
   */
  setQuest(chapter, desc, current, total) {
    if (this._questChapter) this._questChapter.textContent = `📖 ${chapter}`;
    if (this._questDesc) this._questDesc.textContent = `🎯 ${desc}`;
    this._updateProgress(current, total);
  }

  /**
   * 更新任务进度
   * @param {number} current
   * @param {number} total
   */
  updateProgress(current, total) {
    this._updateProgress(current, total);
  }

  /**
   * 处理逐词评分事件 — 更新法力、生命、金币、倍率
   * @param {number} tier - 0~10
   * @param {boolean} [isGoldChant=false]
   */
  onWordScored(tier, isGoldChant = false) {
    const [manaEffect, hpEffect] = TIER_EFFECTS[tier] || [0, 0];
    const multiplier = isGoldChant ? 4 : 1;

    this._state.mana = Math.max(0, Math.min(this._state.maxMana,
      this._state.mana + manaEffect * multiplier));
    this._state.hp = Math.max(0, Math.min(this._state.maxHp,
      this._state.hp + hpEffect * multiplier));

    // 金币
    if (tier === 10) {
      this._state.gold += GOLD_REWARDS.perfect;
    }

    this._renderBars();
    this._renderGold();
  }

  /**
   * 更新 combo 显示
   * @param {number} combo
   * @param {number} maxCombo
   */
  updateCombo(combo, maxCombo) {
    this._state.combo = combo;
    this._state.maxCombo = Math.max(this._state.maxCombo, maxCombo);

    // 每 10 combo 奖金币
    if (combo > 0 && combo % 10 === 0) {
      this._state.gold += GOLD_REWARDS.comboBonus;
      this._renderGold();
    }

    // 倍率：连续 combo 提升
    if (combo >= 30) this._state.boost = 2.0;
    else if (combo >= 20) this._state.boost = 1.5;
    else if (combo >= 10) this._state.boost = 1.2;
    else this._state.boost = 1.0;

    this._renderCombo();
  }

  /**
   * 句子通过时奖励
   */
  onSentencePass() {
    this._state.gold += GOLD_REWARDS.sentencePass;
    this._renderGold();
  }

  /**
   * 获取当前状态
   * @returns {PlayerState}
   */
  getState() {
    return { ...this._state };
  }

  /**
   * 生命是否归零
   * @returns {boolean}
   */
  isKO() {
    return this._state.hp <= 0;
  }

  // ── 渲染方法 ──

  _renderAll() {
    this._renderBars();
    this._renderGold();
    this._renderCombo();
  }

  _renderBars() {
    const manaPct = (this._state.mana / this._state.maxMana) * 100;
    const hpPct = (this._state.hp / this._state.maxHp) * 100;

    if (this._manaBar) {
      this._manaBar.style.width = `${manaPct}%`;
      this._manaBar.classList.toggle('rps-bar-low', manaPct <= 20);
    }
    if (this._manaValue) {
      this._manaValue.textContent = `${this._state.mana}/${this._state.maxMana}`;
    }
    if (this._hpBar) {
      this._hpBar.style.width = `${hpPct}%`;
      this._hpBar.classList.toggle('rps-bar-low', hpPct <= 20);
    }
    if (this._hpValue) {
      this._hpValue.textContent = `${this._state.hp}/${this._state.maxHp}`;
    }
  }

  _renderGold() {
    if (this._coinValue) {
      this._coinValue.textContent = this._state.gold.toLocaleString();
      this._bump(this._coinValue);
    }
  }

  _renderCombo() {
    if (this._comboHudValue) {
      this._comboHudValue.textContent = `×${this._state.combo}`;
      if (this._state.combo >= 2) this._bump(this._comboHudValue);
    }
    if (this._boostHudValue) {
      this._boostHudValue.textContent = `×${this._state.boost.toFixed(1)}`;
    }
  }

  _updateProgress(current, total) {
    const pct = total > 0 ? (current / total) * 100 : 0;
    if (this._questFill) this._questFill.style.width = `${pct}%`;
    if (this._questCount) this._questCount.textContent = `${current}/${total}`;
  }

  /**
   * 数值变化弹跳效果
   * @param {HTMLElement} el
   */
  _bump(el) {
    el.classList.add('rps-value-bump');
    setTimeout(() => el.classList.remove('rps-value-bump'), 200);
  }
}
