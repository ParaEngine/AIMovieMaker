// =================== 影视配音秀 — 计分模块 ===================

import { SCORING_CONFIG } from '../config.js';

/**
 * 跟踪配音成绩
 */
export class Scoring {
  constructor() {
    /** @type {Map<number, number>} cueIndex → 尝试次数 */
    this._attempts = new Map();
    this._totalScore = 0;
    this._totalCues = 0;
    this._passedCues = 0;
  }

  /**
   * 设置总配音段数
   * @param {number} total
   */
  setTotalCues(total) {
    this._totalCues = total;
  }

  /**
   * 记录一次配音尝试
   * @param {number} cueIndex
   * @param {boolean} passed
   */
  recordAttempt(cueIndex, passed) {
    const current = this._attempts.get(cueIndex) || 0;
    this._attempts.set(cueIndex, current + 1);

    if (passed) {
      this._passedCues++;
      const retries = current; // 本段重试次数 = 之前的尝试次数
      if (retries === 0) {
        this._totalScore += SCORING_CONFIG.firstPassScore;
      } else {
        this._totalScore += Math.max(0, SCORING_CONFIG.retryPassScore - retries * SCORING_CONFIG.retryPenalty);
      }
    }
  }

  /**
   * 获取某段的尝试次数
   * @param {number} cueIndex
   * @returns {number}
   */
  getAttempts(cueIndex) {
    return this._attempts.get(cueIndex) || 0;
  }

  /**
   * 总重试次数（所有段的额外尝试之和）
   */
  get totalRetries() {
    let retries = 0;
    for (const [, attempts] of this._attempts) {
      if (attempts > 1) retries += (attempts - 1);
    }
    return retries;
  }

  /**
   * 计算星级
   * @returns {number} 1-3
   */
  get stars() {
    const retries = this.totalRetries;
    if (retries <= SCORING_CONFIG.stars.three) return 3;
    if (retries <= SCORING_CONFIG.stars.two) return 2;
    return 1;
  }

  /**
   * 获取结果摘要
   */
  getSummary() {
    return {
      score: this._totalScore,
      stars: this.stars,
      passed: this._passedCues,
      total: this._totalCues,
      retries: this.totalRetries,
    };
  }

  /**
   * 重置
   */
  reset() {
    this._attempts.clear();
    this._totalScore = 0;
    this._passedCues = 0;
  }
}
