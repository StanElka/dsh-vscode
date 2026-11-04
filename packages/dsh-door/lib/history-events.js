/** Project public sessionQuery events into bounded history cards and transcripts. */
function textOf(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

/** 拼接 reasoning 块（思考过程）。 */
function reasoningOf(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'reasoning' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

/**
 * 一份会话的「名片」：标题、目录、回合数等列表所需的信息。
 *
 * @param {object[]} events 解出的事件流。
 * @param {object} meta {file, mtime, size}
 */
export function summarizeSession(events, meta = {}) {
  let id = '';
  let title = '';
  let cwd = '';
  let preset = '';
  let createdAt = 0;
  let turns = 0;
  let userMessages = 0;
  let firstUserText = '';
  let lastTime = 0;
  for (const event of events) {
    if (typeof event.time === 'number' && event.time > lastTime) lastTime = event.time;
    switch (event.type) {
      case 'session':
        id = typeof event.id === 'string' ? event.id : '';
        cwd = typeof event.cwd === 'string' ? event.cwd : '';
        createdAt = typeof event.createdAt === 'number' ? event.createdAt : 0;
        preset = typeof event.agentPreset === 'string' ? event.agentPreset : '';
        break;
      case 'session/title':
        if (!title && event.data && typeof event.data.title === 'string') title = event.data.title;
        break;
      case 'user/message': {
        const kind = event.data && event.data.source ? event.data.source.kind : undefined;
        if (kind !== 'user') break; // 插件写入的系统消息不计入用户发言
        userMessages += 1;
        if (!firstUserText) {
          firstUserText = textOf(event.data && event.data.content).replace(/\s+/g, ' ').slice(0, 80);
        }
        break;
      }
      case 'turn/start':
        turns += 1;
        break;
      default:
        break;
    }
  }
  const card = {
    id,
    title,
    /** 标题缺失时的后备值：用户的第一句话。 */
    fallbackTitle: firstUserText,
    cwd,
    preset,
    createdAt,
    /** 会话中最后一个事件的时间（比目录 mtime 更接近「最后一次发言时刻」）。 */
    lastTime: lastTime || createdAt,
    turns,
    userMessages,
  };
  if (meta.file !== undefined) card.file = meta.file;
  if (meta.mtime !== undefined) card.mtime = meta.mtime;
  if (meta.size !== undefined) card.size = meta.size;
  return card;
}

/**
 * 重建一段会话的回放：用户发送的内容、模型的应答、调用过的工具。
 *
 * 顺序按事件的 seq 排列。工具卡片在**收到结果**时生成（call 与 result 天然成对，
 * 仅收到 call 而未收到 result 的情形（中断）不渲染 —— 回放中出现一张没有结果的
 * 卡片只会造成用户困惑）。
 *
 * @param {object[]} events
 * @param {object} [options]
 * @param {number} [options.maxEntries] 最多回放的条数（防止把数 MB 的转写内容传给界面）。
 * @param {number} [options.maxChars] 单条文本的最大长度，超出时截断并注明。
 * @returns {{entries: object[], truncated: boolean}}
 */
function transcriptImages(content) {
  const images = [];
  let bytes = 0, omitted = false, visited = 0;
  const visit = (blocks, depth) => {
    if (depth > 4) { omitted = true; return; }
    for (const block of blocks) {
      if (++visited > 512) { omitted = true; return; }
      if (block?.type === 'tool-result' && Array.isArray(block.content)) { visit(block.content, depth + 1); continue; }
      if (block?.type === 'content' && block.content && typeof block.content === 'object') { visit(Array.isArray(block.content) ? block.content : [block.content], depth + 1); continue; }
      if (block?.type !== 'image') continue;
      const ref = block.attachment;
      if (!ref || !/^sha256:[a-f0-9]{64}$/.test(ref.attachmentId || '') || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(ref.mediaType) ||
        !Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > 8 * 1024 * 1024 ||
        !Number.isSafeInteger(ref.width) || !Number.isSafeInteger(ref.height) || ref.width < 1 || ref.height < 1 || ref.width > 8192 || ref.height > 8192 ||
        images.length >= 4 || bytes + ref.bytes > 16 * 1024 * 1024) { omitted = true; continue; }
      bytes += ref.bytes;
      images.push({ attachment: Object.fromEntries(['attachmentId', 'mediaType', 'width', 'height', 'bytes'].map(key => [key, ref[key]])) });
    }
  };
  visit(Array.isArray(content) ? content : [], 0);
  return { images, notice: omitted ? '[图片未载入：历史图片信息无效或超过回放限制]' : '' };
}

export function sessionTranscript(events, { maxEntries = 2000, maxChars = 50000 } = {}) {
  const clip = (text, hardLimit = maxChars) => {
    if (typeof text !== 'string' || text.length <= hardLimit) return text || '';
    return `${text.slice(0, hardLimit)}\n…（回放截断，原文更长）`;
  };
  const entries = [];
  const calls = new Map(); // callId → {name, args}
  let truncated = false;

  const push = (entry) => {
    if (entries.length >= maxEntries) {
      truncated = true;
      return false;
    }
    entries.push(entry);
    return true;
  };

  for (const event of events) {
    switch (event.type) {
      case 'user/message': {
        const kind = event.data && event.data.source ? event.data.source.kind : undefined;
        if (kind !== 'user') break;
        const visual = transcriptImages(event.data?.content);
        const text = [clip(textOf(event.data && event.data.content)), visual.notice].filter(Boolean).join('\n');
        if (!text.trim() && !visual.images.length) break;
        if (!push({ kind: 'user', text, ...(visual.images.length ? { images: visual.images } : {}) })) return { entries, truncated };
        break;
      }
      case 'assistant/message': {
        const content = (event.data && event.data.message && event.data.message.content) || [];
        const visual = transcriptImages(content);
        const text = [clip(textOf(content)), visual.notice].filter(Boolean).join('\n');
        const thinking = reasoningOf(content);
        if (!text.trim() && !thinking.trim() && !visual.images.length) break;
        if (!push({ kind: 'assistant', text, ...(thinking.trim() ? { thinking } : {}), ...(visual.images.length ? { images: visual.images } : {}) })) {
          return { entries, truncated };
        }
        break;
      }
      case 'tool/call': {
        const data = event.data || {};
        if (typeof data.callId === 'string' && data.callId) {
          let args = data.arguments;
          if (typeof args === 'string') {
            try {
              args = JSON.parse(args);
            } catch {
              // arguments 不是合法 JSON 时原样保留为字符串，界面能够显示即可
            }
          }
          calls.set(data.callId, { name: data.name || 'tool', args });
        }
        break;
      }
      case 'tool/result': {
        const callId = event.data?.message?.toolCallId ?? event.data?.message?.source?.callId;
        const call = typeof callId === 'string' ? calls.get(callId) : undefined;
        if (!call) break; // 没有对应 call 的结果不渲染
        const blocks = (event.data.message && event.data.message.content) || [];
        const visual = transcriptImages(blocks);
        const output = [clip(
          blocks
            .map((block) => {
              if (!block) return '';
              if (typeof block.text === 'string') return block.text;
              if (block.type === 'tool-result' && Array.isArray(block.content)) {
                return block.content
                  .filter((part) => part && typeof part.text === 'string')
                  .map((part) => part.text)
                  .join('');
              }
              return '';
            })
            .filter(Boolean)
            .join('\n'),
          20000,
        ), visual.notice].filter(Boolean).join('\n');
        calls.delete(callId);
        if (!push({ kind: 'tool', name: call.name, args: call.args, output, ...(visual.images.length ? { images: visual.images } : {}) })) {
          return { entries, truncated };
        }
        break;
      }
      default:
        break;
    }
  }
  return { entries, truncated };
}
