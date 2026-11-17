import type { ChatProtocol, VisionSupport } from './settings.js'

/**
 * 判断当前模型能否直接识别图片。
 * 从 settings.ts 抽成纯模块，便于独立测试。
 *
 * - 设置为 yes / no 时以用户为准
 * - auto 时按模型名推断：命中常见多模态模型片段则视为支持
 * - DeepSeek 原生协议的普通对话模型不支持直接看图
 * - 其余情况按「能」处理，交给服务端决定
 */

/** 常见支持图片输入的多模态模型名片段 */
export const VISION_MODEL_HINTS = [
  'vision',
  'gpt-4o',
  'gpt-4.1',
  'gpt-5',
  'claude',
  'gemini',
  'qwen-vl',
  'qwen2-vl',
  'qwen2.5-vl',
  'llava',
  'pixtral',
  'internvl',
  'glm-4v',
  'deepseek-vl',
  'step-1v',
  'doubao-vision',
  'ernie-vl',
] as const

export const allowsVision = (
  support: VisionSupport,
  model: string,
  protocol?: ChatProtocol
): boolean => {
  if (support === 'yes') {
    return true
  }
  if (support === 'no') {
    return false
  }
  const id = model.trim().toLowerCase()
  if (!id) {
    return false
  }
  if (VISION_MODEL_HINTS.some((hint) => id.includes(hint))) {
    return true
  }
  // DeepSeek 原生协议的对话模型不支持直接看图，需要走视觉渠道
  if (protocol === 'deepseek') {
    return false
  }
  return true
}
