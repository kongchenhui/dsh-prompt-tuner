# Changelog

## [Unreleased]

### Changed

- 按钮状态改为按会话隔离：切换会话再切回来，「恢复原文」、失败原因和进行中的优化都
  还在；在一个会话里取消或失败不再影响其他会话。

### Fixed

- 优化进行中切换会话不再中止请求；结果会写回发起它的那个会话，而不是被丢弃。

## [0.1.1] - 2026-11-05

### Fixed

- 修复 Windows 上无法打开配置文件的问题。

[0.1.1]: https://github.com/kongchenhui/dsh-prompt-tuner/releases/tag/v0.1.1
