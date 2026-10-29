import type { AssistantReply, ChatEvent } from "../../shared/types";
import { delay } from "./api";

export function demoReply(text: string): AssistantReply {
  if (/难过|累|失眠|焦虑|压力|烦|不开心|低落|糟|孤独|失落|不想/.test(text)) {
    return { emotion: "sympathetic", messages: ["先不用急着让自己好起来，我在这儿听你说。", "今天最让你觉得累的，是什么？"] };
  }
  if (/开心|完成|成功|好消息|升职|通过|太棒|终于|奖励/.test(text)) {
    return { emotion: "excited", messages: ["这件事值得好好开心一下！", "给今天的自己留一点庆祝时间吧。"] };
  }
  if (/意外|惊讶|没想到|居然/.test(text)) {
    return { emotion: "surprised", messages: ["哇，确实是个意料之外的转折。", "后来发生了什么？"] };
  }
  if (/灵感|创意|点子|做点|周末|无聊/.test(text)) {
    return { emotion: "curious", messages: ["试试给今天收集三种声音：窗外、街角，还有你喜欢的一首歌。", "把它们写成一句话，或许就是一个小故事的开头。"] };
  }
  if (/api|接口|点阵|怎么|为什么|解释|什么是|代码/i.test(text)) {
    return { emotion: "thinking", messages: ["我现在是由图片生成的粒子角色，眼睛和嘴巴能单独动。", "接入模型后，回复里的情绪标签会驱动我的表情。现在这段是本地演示。"] };
  }
  if (/你好|嗨|hello|hi\b/i.test(text)) {
    return { emotion: "happy", messages: ["嗨，我是点点。很高兴见到你！", "不用想好话题，随便说说也可以。"] };
  }
  return { emotion: "happy", messages: ["我在听。不过现在是演示模式，还不能真正理解和回答所有问题。", "点输入栏左侧的小图标，接入模型后就能自由聊了。"] };
}

export async function runDemo(text: string, signal: AbortSignal, onEvent: (event: ChatEvent) => void) {
  const reply = demoReply(text);
  await delay(850, signal);
  onEvent({ type: "emotion", emotion: reply.emotion });
  for (const [index, message] of reply.messages.entries()) {
    await delay(index === 0 ? 220 : 380, signal);
    onEvent({ type: "message", index, text: message });
  }
  onEvent({ type: "done" });
}
