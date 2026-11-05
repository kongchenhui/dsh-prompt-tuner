/**
 * One `settings.theme`-style namespace dictionary, single-sourced.
 *
 * The copy lives here rather than in `locale/*.json` because the plugin ships
 * the strings inside the browser bundle; the JSON files the harness reads for
 * marketplace metadata are generated from {@link dictionaries} so the two
 * cannot drift.
 */

/** Simplified Chinese dictionary; the key set every other language mirrors. */
export const zh = {
  'meta.title': '提示词优化',
  'meta.description': '在输入框一键优化或纠错提示词，改写用的提示词与模型可自定义。',
  enhance: '增强提示词',
  running: '增强中…',
  restore: '恢复原文',
  errorAuth: '模型认证失败',
  errorRateLimited: '请求过于频繁',
  errorUpstream: '模型服务异常',
  sectionLabel: '提示词优化',
  loading: '正在读取设置…',
  loadFailed: '无法读取设置',
  promptLabel: '优化提示词',
  modelLabel: '模型',
  modelHint: '跟随当前会话时使用输入框选中的模型',
  modelFollow: '跟随当前会话',
  modelSearch: '搜索模型…',
  modelEmpty: '没有匹配的模型',
  modelAria: '当前模型：{model}，点击更换',
  tokensLabel: '最大输出 tokens',
  tokensHint: '上限 2048',
  save: '保存',
  saving: '保存中…',
  saved: '已保存',
  unsaved: '有未保存的修改',
  saveFailed: '保存失败',
  restoreDefault: '恢复默认提示词',
  fileLabel: '配置文件',
  fileOpenHint: '点击用系统编辑器打开',
  fileOpened: '已在编辑器中打开',
} as const

/** Key union of the namespace; every other dictionary must cover it. */
export type LocaleKey = keyof typeof zh

/** English dictionary, checked complete against the Chinese key set. */
export const en: Record<LocaleKey, string> = {
  'meta.title': 'Prompt Tuner',
  'meta.description': 'Rewrite or correct the composer draft in one click, with an editable prompt and model.',
  enhance: 'Enhance prompt',
  running: 'Enhancing…',
  restore: 'Restore original',
  errorAuth: 'Model authentication failed',
  errorRateLimited: 'Rate limited',
  errorUpstream: 'Model service error',
  sectionLabel: 'Prompt Tuner',
  loading: 'Loading settings…',
  loadFailed: 'Could not load settings',
  promptLabel: 'Tuning prompt',
  modelLabel: 'Model',
  modelHint: 'Following the conversation uses the model selected in the composer',
  modelFollow: 'Follow current conversation',
  modelSearch: 'Search models…',
  modelEmpty: 'No matching models',
  modelAria: 'Current model: {model}. Click to change.',
  tokensLabel: 'Max output tokens',
  tokensHint: 'Up to 2048',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saveFailed: 'Save failed',
  restoreDefault: 'Restore default prompt',
  fileLabel: 'Config file',
  fileOpenHint: 'Click to open in your editor',
  fileOpened: 'Opened in your editor',
}

/** Every shipped dictionary by locale tag. */
export const dictionaries = { zh, en } as const

/** Locale tag one dictionary ships as. */
export type LocaleTag = keyof typeof dictionaries
