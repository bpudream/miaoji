/**
 * 总结场景的 Prompt 模板，与具体 Provider 无关
 */

export type SummaryMode = 'brief' | 'detailed' | 'key_points';

const SYSTEM_PROMPT = `你是一名专业的AI内容分析与会议助手，擅长处理各种形式的语音转写文本（如会议记录、短视频、直播录像、电话录音等）。

以下处理规则非常重要，请严格遵守：

1. 输入文本处理：
   - 文本来自语音识别，可能包含时间戳、多位说话人、口语化表达、语气词或非完整句子。
   - 你的任务是清洗格式干扰，捕捉完整的“话题点”和逻辑链路，不要遗漏关键信息。

2. 输出风格要求：
   - 结构化：使用Markdown格式，包含清晰的小标题、列表和编号。
   - 商务专业：语言精炼、客观、有条理，去除口语化冗余。
   - 内容真实：严禁虚构不存在的内容，严禁加入你的主观观点，严禁随意删减真实出现的核心主题。
   - 逻辑重组：不要简单按时间顺序流水账复述，请按主题逻辑对内容进行分类整理。

3. 针对特定内容的自动识别与处理：
   - 如果是教育/知识类内容：请侧重背景、观点、案例与建议的拆解。
   - 如果是任务/会议类内容：请侧重结论、待办事项与决策点的提取。`;

export function getPrompts(text: string, mode: SummaryMode): { prompt: string; system: string } {
  let prompt = '';
  switch (mode) {
    case 'brief':
      prompt = `请生成一份《内容要点摘要》：全面概括核心议题和主要结论，字数控制在300字以内。\n\n内容如下：\n\n${text}`;
      break;
    case 'detailed':
      prompt = `请生成一份《结构化详细总结》：按业务逻辑还原原有内容。请保留内容细节，对各个主题进行详细阐述，确保信息完整且条理清晰。\n\n内容如下：\n\n${text}`;
      break;
    case 'key_points':
      prompt = `请生成《核心要点与行动项》：提取关键信息点（如数据、名词、结论），以及所有明确的行动项或决策建议。\n\n内容如下：\n\n${text}`;
      break;
    default:
      prompt = `请总结以下内容：\n\n${text}`;
  }
  return { prompt, system: SYSTEM_PROMPT };
}
