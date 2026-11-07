/** 从实际加载的 ACP 包读取运行时版本；不使用构建机或用户设置中的版本。 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const ACP_RUNTIME_VERSION = require('@deepseek-ai/dsh-acp/package.json').version;

/** 此接入点随内核接口一起验收，目标版本以包声明为准。 */
export const ACP_TARGET_VERSION = require('../../package.json').peerDependencies['@deepseek-ai/dsh-acp'];
