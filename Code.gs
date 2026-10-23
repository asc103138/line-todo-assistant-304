/**
 * ==============================================================================
 * 國小中年級導師 LINE 專屬智慧助教系統 (LINE Bot + GAS + Gemini 2.5/1.5 Flash)
 * ==============================================================================
 * 包含功能：
 * 1. 每日 07:00 晨間自動比對當日課表與學校行事曆，推播各節次行程建議
 * 2. 每日 17:00 傍晚自動觸發 RDQ 復盤訪談，訪談結束由 Gemini 生成明日每節課待辦清單
 * 3. 雙向多模態 Gemini 分析：
 *    - 上傳收據/明細照片 -> 自動 OCR 解析品項、金額、廠商，歸類寫入「班費收支」支出欄
 *    - 語音/文字/照片記錄學生突發事件 -> 自動萃取人事物、給予親師溝通草稿，存入「學生突發」
 * 4. 國小導師 6 格圖文選單處理邏輯
 * 5. doGet 提供現代化 Web 儀表板，即時掌握班費結餘、待辦進度與突發事件追蹤
 * ==============================================================================
 */

// ======================== 【全域系統參數設定】 ========================
// 請在 Google Apps Script「專案設定」->「指令碼屬性」中設定以下金鑰，或直接於下方預設值填入：
const SCRIPT_PROPERTIES = PropertiesService.getScriptProperties();

const CONFIG = {
  // LINE 開發者憑證 (可在 LINE Developers Console 取得)
  CHANNEL_ACCESS_TOKEN: SCRIPT_PROPERTIES.getProperty('CHANNEL_ACCESS_TOKEN') || 'YOUR_CHANNEL_ACCESS_TOKEN',
  CHANNEL_SECRET: SCRIPT_PROPERTIES.getProperty('CHANNEL_SECRET') || 'YOUR_CHANNEL_SECRET',
  TEACHER_USER_ID: SCRIPT_PROPERTIES.getProperty('TEACHER_USER_ID') || '', // 初次傳訊時系統會自動鎖定老師的 LINE ID
  
  // Google Gemini API Key (https://aistudio.google.com/app/apikey)
  GEMINI_API_KEY: SCRIPT_PROPERTIES.getProperty('GEMINI_API_KEY') || 'YOUR_GEMINI_API_KEY',
  GEMINI_MODEL: 'gemini-2.5-flash', // 或 gemini-1.5-flash

  // 班級基本設定 (RDQ 訪談確認值：28人，每人300元)
  STUDENT_COUNT: 28,
  CLASS_FEE_PER_STUDENT: 300,
  CLASS_NAME: '臺中市梧棲區中正國小 四年丙班 (304班)',

  // 教科書版本鎖定 (遵循 G4 Curriculum Review 全域審查規範，嚴禁跨版本混用)
  TEXTBOOKS: {
    MATH: '南一版 國小數學 4上（南一數，單元一～五：一億以內的數、乘法、角度、除法、三角形）',
    CHINESE: '翰林版 國小國語 4上（翰林國，第一單元：秋天的心情、大自然的美作、水中精靈；第二單元：攀爬夢想的巨石、月光下、走過歷史的痕跡）',
    SOCIAL: '康軒版 國小社會 4上（康軒社，單元一：家鄉在哪裡、單元二：家鄉的環境與生活）',
    LOCAL: '梧風啟航（梧棲海線校本彈性課程，結合臺中港、高美濕地、梧棲老街與海洋文化）'
  },

  // 學生服裝規定 (依據梧棲中正國小 304 課表規定)
  UNIFORMS: {
    '一': '👕 班服（半天課，中午 12:00 放學）',
    '二': '🏃 運動服（全天課，15:50 放學）',
    '三': '🎒 便服（半天課，中午 12:00 放學）',
    '四': '👕 班服（全天課，15:50 放學）',
    '五': '🏃 運動服（全天課，15:50 放學）'
  },

  // 試算表工作表分頁名稱
  SHEETS: {
    SCHEDULE: '課表',
    CALENDAR: '學校行事曆',
    TODOLIST: '每日待辦',
    EXPENSES: '班費收支',
    INCIDENTS: '學生突發',
    RDQ_STATE: 'RDQ暫存'
  }
};

// ======================== 【Web App 入口：doGet & doPost】 ========================

/**
 * 網頁版個人儀表板入口
 */
function doGet(e) {
  // 若為 API 請求資料
  if (e && e.parameter && e.parameter.action === 'getData') {
    const data = getDashboardData();
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // 渲染儀表板前端 HTML
  const template = HtmlService.createTemplateFromFile('dashboard');
  template.config = CONFIG;
  return template.evaluate()
    .setTitle('導師日常駕駛艙｜中年級班級儀表板')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * LINE Webhook 接收與分流核心
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      console.warn('收到空的 Webhook 請求');
      return ContentService.createTextOutput('OK');
    }
    console.log('收到 LINE 請求: ' + e.postData.contents);
    const json = JSON.parse(e.postData.contents);
    const events = json.events;
    if (!events || events.length === 0) {
      return ContentService.createTextOutput('OK');
    }

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const userId = event.source ? event.source.userId : null;

      // 自動記錄或更新導師的 User ID
      if (userId && (!CONFIG.TEACHER_USER_ID || CONFIG.TEACHER_USER_ID !== userId)) {
        SCRIPT_PROPERTIES.setProperty('TEACHER_USER_ID', userId);
        CONFIG.TEACHER_USER_ID = userId;
      }

      if (event.type === 'message') {
        handleIncomingMessage(event);
      } else if (event.type === 'postback') {
        console.log('收到 Postback: ' + JSON.stringify(event.postback));
      }
    }
  } catch (err) {
    console.error('Webhook 處理錯誤: ' + err.toString());
  }
  return ContentService.createTextOutput('OK');
}

// ======================== 【訊息路由與處理】 ========================

function handleIncomingMessage(event) {
  const replyToken = event.replyToken;
  const message = event.message;
  const userId = event.source.userId;

  // 1. 照片多模態處理（發票/收據辨識 或 學生事件佐證照片）
  if (message.type === 'image') {
    replyTextMessage(replyToken, '📷 收到圖片，Gemini 正在為您智慧辨識中，請稍候...');
    processImageWithGemini(message.id, userId);
    return;
  }

  // 2. 文字訊息處理
  if (message.type === 'text') {
    const text = message.text.trim();

    // 檢查是否處於主動式交談狀態機（06:30 晨間安排確認 或 20:00 晚間復盤）
    const session = getSessionState(userId);
    if (session) {
      if (session.state === 'MORNING_PENDING') {
        handleMorningConfirmation(userId, text, replyToken);
        return;
      }
      if (session.state === 'EVENING_PENDING') {
        handleEveningConfirmation(userId, text, replyToken);
        return;
      }
    }

    // 圖文選單與關鍵字分流
    switch (text) {
      case '今日行程':
      case '今日課表':
        replyTodaySchedule(replyToken);
        break;

      case '下班復盤':
      case '下班RDQ':
      case '開始復盤':
      case '晚間復盤':
        triggerEveningInteractiveReview(userId, replyToken);
        break;

      case '晨間安排':
      case '晨間建議':
        sendMorningInteractiveBriefing();
        break;

      case '臨時改變進度':
      case '改進度':
      case '調整進度':
      case '臨時改課':
        handleProgressChange(userId, text, replyToken);
        break;

      case '重新設計進度':
      case '重新設計課程進度':
      case '重排進度':
      case '重新規劃進度':
        handleCurriculumRedesign(userId, text, replyToken);
        break;

      case '班費收支':
      case '班費結餘':
        replyClassFeeSummary(replyToken);
        break;

      case '學生突發':
      case '學生事件':
        replyTextMessage(replyToken, '📝 請直接以文字描述事件（例如：「小明和阿華在第三節下課因為搶球推擠，小明手肘擦傷已擦藥」），或直接傳送相關照片。\n\n我會自動萃取人事物存入資料庫，並提供親師溝通建議！');
        break;

      case '快速備課':
      case '備課指引':
        replyPreparationTips(replyToken);
        break;

      case '個人儀表板':
      case '開啟儀表板':
        const webAppUrl = ScriptApp.getService().getUrl();
        replyTextMessage(replyToken, `📊 點擊下方連結開啟您的「導師個人儀表板」：

${webAppUrl}

（可隨時查看班費動態、今日各節待辦與突發事件時間軸）`);
        break;

      case '重置狀態':
      case '重置復盤':
        clearSessionState(userId);
        replyTextMessage(replyToken, '已重置當前對話狀態。隨時回傳「今日行程」或「下班復盤」即可啟動！');
        break;

      default:
        // 若為一般自然語言，交由 Gemini 分析意圖（是臨時交辦、突發事件、還是教學諮詢）
        handleNaturalLanguageQuery(text, replyToken, userId);
        break;
    }
  }
}

// ======================== 【多模態影像辨識：Gemini API】 ========================

/**
 * 取得 LINE 照片二進位資料並送往 Gemini 分析
 */
function processImageWithGemini(messageId, userId) {
  try {
    const imageBlob = getLineMessageContent(messageId);
    if (!imageBlob) {
      pushMessage(userId, '❌ 無法取得圖片內容，請確認 LINE 憑證是否正常。');
      return;
    }

    const base64Data = Utilities.base64Encode(imageBlob.getBytes());
    const mimeType = imageBlob.getContentType() || 'image/jpeg';

    const prompt = `你是一名專業的國小中年級導師智慧助理。請辨識這張圖片是屬於「廠商明細/發票/收據」還是「教學/學生相關紀錄」：
1. 若為【發票/明細/收據/估價單】：
   - 提取：廠商名稱(vendor)、品項摘要(items)、總金額(total_amount)、花費類別(category，例如：文具教材/活動點心/教室佈置/各類雜支)、開立日期(date)
   - 請輸出 JSON 格式：
   {
     "type": "receipt",
     "vendor": "廠商或商店名",
     "items": "具體項目名稱與數量",
     "amount": 數字(無千分位),
     "category": "文具教材" | "活動點心" | "教室佈置" | "各類雜支",
     "date": "YYYY-MM-DD",
     "summary": "一句話中文摘要"
   }

2. 若為【學生作品/黑板聯絡簿/學生衝突佐證/教學照片】：
   - 請輸出 JSON 格式：
   {
     "type": "incident_or_memo",
     "summary": "畫面重點說明",
     "suggested_action": "給導師的後續建議"
   }

只輸出合法的 JSON 字串，不要包含任何 markdown 標記包裝或多餘贅字。`;

    const geminiResponse = callGeminiVision(base64Data, mimeType, prompt);
    let parsed;
    try {
      const cleanJson = geminiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      pushMessage(userId, `📷 Gemini 辨識結果：\n${geminiResponse}`);
      return;
    }

    if (parsed.type === 'receipt') {
      // 自動記帳進「班費收支」分頁
      addExpenseRecord({
        date: parsed.date || Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd'),
        item: parsed.items || parsed.summary,
        category: parsed.category || '文具教材',
        vendor: parsed.vendor || '廠商',
        amount: Number(parsed.amount) || 0,
        note: `相片自動辨識入帳 (ID: ${messageId})`
      });

      const remaining = calculateBalance();
      const replyMsg = `🧾 【班費支出自動入帳成功】\n` +
        `━━━━━━━━━━━━━━\n` +
        `▫️ 廠商：${parsed.vendor}\n` +
        `▫️ 品項：${parsed.items}\n` +
        `▫️ 類別：${parsed.category}\n` +
        `▫️ 金額：$${parsed.amount.toLocaleString()} 元\n` +
        `━━━━━━━━━━━━━━\n` +
        `💰 班費目前結餘：$${remaining.toLocaleString()} 元\n` +
        `（資料已同步更新至試算表與個人儀表板）`;

      pushMessage(userId, replyMsg);
    } else {
      pushMessage(userId, `📷 【影像辨識筆記】\n\n📌 摘要：${parsed.summary}\n💡 導師建議：${parsed.suggested_action}`);
    }

  } catch (err) {
    console.error('多模態處理失敗: ' + err.toString());
    pushMessage(userId, '⚠️ 圖片解析時發生錯誤，請稍後再試或檢查 API Key。');
  }
}

// ======================== 【主動式智慧助教：06:30 晨間建議 ＆ 20:00 晚間復盤】 ========================

/**
 * 每日 06:30 晨間推播：結合今日課表、行事曆與昨夜復盤，主動提出 3 個安排方案供導師點選與確認臨時交辦
 */
function sendMorningInteractiveBriefing() {
  const teacherId = CONFIG.TEACHER_USER_ID;
  if (!teacherId) {
    console.warn('尚未記錄導師 User ID，無法發送 06:30 晨間推播。');
    return;
  }

  const today = new Date();
  const dayOfWeek = today.getDay();
  // 週末不上課
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    console.info('週末不上課，跳過 06:30 晨間推播。');
    return;
  }

  const todayStr = Utilities.formatDate(today, 'GMT+8', 'yyyy-MM-dd');
  const dayZh = getDayOfWeekZh(dayOfWeek);
  const schedule = getScheduleByDay(dayZh);
  const calendarEvents = getCalendarEvents(todayStr);
  const yesterdayPlan = getSavedPlan(todayStr); // 昨日 20:00 復盤為今日規劃之初步基底
  const uniformNote = CONFIG.UNIFORMS[dayZh] || '便服';

  const prompt = `你是一名專屬支援【臺中市梧棲區中正國民小學 四年丙班 (304班)】的專業教務智慧助教。
你必須嚴格遵守【G4 Curriculum Review 全域三階漏斗審查規範】：
- 教科書版本：南一數學 4上、翰林國語 4上、康軒社會 4上、校本彈性梧風啟航
- 學校重大期程：11/05-11/06 第一次定期評量（期中考）
- 在地情境：臺中港區、梧棲漁港、高美濕地、九降風海風文化

今天是 ${todayStr} 星期${dayZh}。
服裝與放學規定：${uniformNote}
今日課表節次：
${JSON.stringify(schedule, null, 2)}
今日學校重大行事：${calendarEvents.length > 0 ? calendarEvents.join('、') : '常規教學日，無全校重大集會'}
昨晚 20:00 復盤產出之初步規劃基底：
${yesterdayPlan || '無前置待辦記錄，按表操課'}

【重要核心要求 - 每一節課皆提供三種具體建議】：
導師要的不是空泛問句，而是【精確到每一節課都提供 3 種具體建議方案供他直接點選或組合】，並具備隨時臨時改進度與重新設計進度的彈性！
請依據南一數、翰林國、康軒社、校本梧風啟航之真實單元進度與今日課表，針對【早自修至第七節、放學】的每一節課，皆給予 3 種備選安排：
- [A] 標準進度：南一數/翰林國/康軒社之單元核心概念講授、例題引導。
- [B] 習作補救：課堂實作、習作批閱演練、針對四年級典型迷思（除法位值/角度測量/生字部件）補救。
- [C] 在地探究：結合梧棲海線生活情境（臺中港、高美濕地、九降風、梧棲老街）之生活化應用、小組討論或多元評量。
（若為科任課，則提供三種帶隊、用具檢查與秩序叮嚀選項）

請以極具結構感、清晰好讀的繁體中文條列呈現：
☀️ 今日總覽：服裝提醒 + 放學時間 + 學校重大行事
⏰ 各節次三選一提案：
▫️ 早自修 (07:50-08:40)：[A]... | [B]... | [C]...
▫️ 第一節 (08:45-09:25) [科目]：[A]... | [B]... | [C]...
▫️ 第二節 (09:35-10:15) [科目]：[A]... | [B]... | [C]...
...依今日所有節次依序列出...
▫️ 午餐/放學：注意事項

文末引導導師：「您可回傳『全選A』、『全選B』，或輸入客製微調（如『第1節B，其餘A』）。亦可隨時點選『臨時改變進度』或『重新設計進度』！」`;

  const proposalText = callGeminiText(prompt);

  saveSessionState(teacherId, 'MORNING_PENDING', {
    date: todayStr,
    dayZh: dayZh,
    proposal: proposalText
  });

  const quickReplies = [
    { label: '✅ 全選進度(全A)', text: '全選A' },
    { label: '📘 全選補救(全B)', text: '全選B' },
    { label: '⚡ 臨時改變進度', text: '臨時改變進度' },
    { label: '🔄 重新設計進度', text: '重新設計進度' }
  ];

  pushMessageWithQuickReply(teacherId, `☀️ 【06:30 晨間課程安排與主動建議】
━━━━━━━━━━━━━━
${proposalText}`, quickReplies);
}

/**
 * 處理導師對 06:30 晨間建議的確認與臨時交辦
 */
function handleMorningConfirmation(userId, text, replyToken) {
  const session = getSessionState(userId);
  const today = new Date();
  const todayStr = Utilities.formatDate(today, 'GMT+8', 'yyyy-MM-dd');
  const dayZh = getDayOfWeekZh(today.getDay());

  const prompt = `你是一名【臺中市梧棲區中正國小 304 班】智慧助教。
今晨系統提供給導師的提案建議如下：
${session ? session.data.proposal : '常規建議'}

導師的回覆為：「${text}」

請根據導師的選擇（如選方案A、B、C）以及是否有補充的【臨時交辦事項/客製微調】：
1. 整合為今日最終執行的【早自修至第七節 課表待辦與臨時交辦總清單】。
2. 清楚標明：
   - 📌 今日確認採用方案
   - ⚡ 臨時交辦/特別提醒事項（若有）
   - ⏰ 早自修至第七節課堂執行重點
請以精簡親切、條列明確的繁體中文輸出：`;

  const finalPlan = callGeminiText(prompt);

  saveTomorrowPlanToSheet(todayStr, dayZh, finalPlan);
  clearSessionState(userId);

  replyTextMessage(replyToken, `✅ 【今日課程安排與交辦已正式鎖定】
━━━━━━━━━━━━━━
${finalPlan}
━━━━━━━━━━━━━━
💡 已同步更新至個人儀表板。今晚 20:00 我會主動為您發送今日復盤診斷與明日行程建議！祝老師今天教學愉快順心！`);
}

/**
 * 每日 20:00 晚間推播：主動提供今日復盤診斷選項，並規劃明日行程
 */
function triggerEveningInteractiveReview(targetUserId, replyToken) {
  const teacherId = targetUserId || CONFIG.TEACHER_USER_ID;
  if (!teacherId) return;

  const today = new Date();
  const dayOfWeek = today.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    const msg = '☕ 週末放假好好休息！週日晚間 20:00 我會自動為您梳理週一的課程與行事建議！';
    if (replyToken) replyTextMessage(replyToken, msg);
    return;
  }

  const todayStr = Utilities.formatDate(today, 'GMT+8', 'yyyy-MM-dd');
  const dayZh = getDayOfWeekZh(dayOfWeek);
  const todaySchedule = getScheduleByDay(dayZh);
  const todayPlan = getSavedPlan(todayStr) || '今日照常規課表進行';

  // 明日資訊
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = Utilities.formatDate(tomorrow, 'GMT+8', 'yyyy-MM-dd');
  const tomorrowDayZh = getDayOfWeekZh(tomorrow.getDay());
  const tomorrowSchedule = getScheduleByDay(tomorrowDayZh);
  const tomorrowCalendar = getCalendarEvents(tomorrowStr);
  const tomorrowUniform = CONFIG.UNIFORMS[tomorrowDayZh] || '便服';

  // 今日突發事件
  const recentIncidents = getRecentIncidents(todayStr);

  const prompt = `你是一名【臺中市梧棲區中正國小 四年丙班 (304班)】的資深教學助教。
現在是晚間 20:00 復盤時間。
【今日回顧】：
- 今日（${todayStr} 週${dayZh}）課表：${JSON.stringify(todaySchedule)}
- 今晨確認之待辦與交辦：${todayPlan}
- 今日記錄之突發事件：${recentIncidents.length > 0 ? recentIncidents.join('；') : '無特殊突發紀錄，常規良好'}

【明日展望】：
- 明日（${tomorrowStr} 週${tomorrowDayZh}）課表：${JSON.stringify(tomorrowSchedule)}
- 明日學校重大行事：${tomorrowCalendar.length > 0 ? tomorrowCalendar.join('、') : '常規教學日'}
- 明日學生服裝與放學：${tomorrowUniform}

【核心任務要求 - 明日各節次皆提供三種具體選項】：
不要叫老師從零打字填空！請根據今日實際進度與明日課表，主動梳理今日狀況，並為【明日每一節課（早自修至第七節）】精確規劃 3 種可選的課堂待辦建議：
- [A] 標準進度：南一數/翰林國/康軒社之單元正常推進。
- [B] 精練補救：習作加強、易錯迷思補救（除法退位、角度量測、國語形式深究練習）。
- [C] 探究實作：梧棲海線在地連結（臺中港/高美濕地/九降風）、小組發表或活動。

請輸出結構清晰的繁體中文：
1. 🌙 今日復盤摘要（課堂完成度、臨時交辦執行狀態）
2. 📋 明日課表節次三選一提案：
   ▫️ 早自修 (07:50-08:40)：[A]... | [B]... | [C]...
   ▫️ 第一節 (08:45-09:25) [科目]：[A]... | [B]... | [C]...
   ▫️ 第二節 (09:35-10:15) [科目]：[A]... | [B]... | [C]...
   ...依明日節次依序展開...
3. 提示導師：「可回傳『全選A』、『全選B』，或指定微調。亦可點選下方按鈕臨時改變進度或重新設計進度！」`;

  const reviewProposal = callGeminiText(prompt);

  saveSessionState(teacherId, 'EVENING_PENDING', {
    todayStr: todayStr,
    tomorrowStr: tomorrowStr,
    tomorrowDayZh: tomorrowDayZh,
    tomorrowSchedule: tomorrowSchedule,
    tomorrowCalendar: tomorrowCalendar,
    tomorrowUniform: tomorrowUniform,
    proposal: reviewProposal
  });

  const quickReplies = [
    { label: '✅ 明日全選 A', text: '全選A' },
    { label: '📘 明日全選 B', text: '全選B' },
    { label: '⚡ 臨時改變進度', text: '臨時改變進度' },
    { label: '🔄 重新設計進度', text: '重新設計進度' }
  ];

  const msgText = `🌙 【20:00 晚間復盤與明日行程建議】
━━━━━━━━━━━━━━
${reviewProposal}`;

  if (replyToken) {
    replyTextMessageWithQuickReply(replyToken, msgText, quickReplies);
  } else {
    pushMessageWithQuickReply(teacherId, msgText, quickReplies);
  }
}

/**
 * 處理導師對 20:00 晚間復盤的選擇，並排定明日早自修至第七節待辦
 */
function handleEveningConfirmation(userId, text, replyToken) {
  const session = getSessionState(userId);
  const data = session ? session.data : {};
  
  const tomorrowStr = data.tomorrowStr || Utilities.formatDate(new Date(Date.now() + 86400000), 'GMT+8', 'yyyy-MM-dd');
  const tomorrowDayZh = data.tomorrowDayZh || getDayOfWeekZh(new Date(Date.now() + 86400000).getDay());
  const tomorrowSchedule = data.tomorrowSchedule || getScheduleByDay(tomorrowDayZh);
  const tomorrowCalendar = data.tomorrowCalendar || getCalendarEvents(tomorrowStr);
  const tomorrowUniform = data.tomorrowUniform || (CONFIG.UNIFORMS[tomorrowDayZh] || '便服');

  const prompt = `你是一名專屬支援【臺中市梧棲區中正國小 四年丙班 (304班)】的專業教務助教。
在晚間 20:00 復盤中，導師做出的選擇與回饋為：「${text}」
參考原提案：
${data.proposal || ''}

明日資訊：
- 日期：${tomorrowStr} 星期${tomorrowDayZh}（${tomorrowUniform}）
- 課表節次：${JSON.stringify(tomorrowSchedule)}
- 學校重大行事：${tomorrowCalendar.length > 0 ? tomorrowCalendar.join('、') : '常規教學日'}

【任務要求】：
請根據導師的復盤選擇與反饋，嚴格遵守南一數、翰林國、康軒社、校本梧風啟航之進度，為導師完整產出【明日（${tomorrowStr} 週${tomorrowDayZh}）早自修至第七節 客製化教學待辦與備課清單】：
- ☀️ 早自修 (07:50-08:40)：聯絡簿、作業收取、晨讀或導師補救交代
- 📘 第一節課至第七節課：每一節課的具體教學重點（導師課）或帶隊叮嚀（科任課）
- 🍱 午餐與午休 / 🎒 放學時間與路隊
- 💡 特別提醒（今日導師交辦之追蹤）

請輸出結構清晰、充滿溫度且可以直接執行的繁體中文清單：`;

  const tomorrowPlan = callGeminiText(prompt);

  saveTomorrowPlanToSheet(tomorrowStr, tomorrowDayZh, tomorrowPlan);
  clearSessionState(userId);

  replyTextMessage(replyToken, `📋 【明日（${tomorrowStr} 週${tomorrowDayZh}）各節次待辦與建議已排定】
━━━━━━━━━━━━━━
${tomorrowPlan}
━━━━━━━━━━━━━━
💡 此規劃已同步至試算表與個人儀表板。明晨 06:30 會主動為您發送晨間確認！祝老師今晚好眠！`);
}

// 相容舊函式
function sendMorningBriefing() {
  sendMorningInteractiveBriefing();
}

function triggerEveningRDQ() {
  triggerEveningInteractiveReview();
}

// ======================== 【突發事件與自然語言處理】 ========================

function handleNaturalLanguageQuery(text, replyToken, userId) {
  const prompt = `你是一名溫暖且精準的國小四年級導師 AI 智慧助理（支援臺中梧棲中正國小 304 班）。
導師傳送了一段自然語言訊息：「${text}」

請分析此訊息之意圖：
1. 若屬於【臨時交辦 / 待辦備忘 / 行程微調】（如：「中午要交教學省思」、「第3節要加發校慶通知」、「明天第一節收國隨」）：
   - 請輸出標記：[SAVE_TODO:{"task":"具體待辦內容","period":"時間或節次"}]
   - 同時輸出簡短確認回覆，告訴導師已排入待辦清單。
2. 若屬於【學生突發事件 / 受傷 / 常規衝突 / 親師爭議】：
   - 請提供：事件摘要、當下應對步驟、一則親師溝通 LINE 簡訊草稿（語氣同理、正向客觀）。
   - 請輸出標記：[SAVE_INCIDENT:{"student":"","type":"衝突/受傷/課業/常規","description":"摘要"}]
3. 若非上述，只是隨手筆記或一般教育教學詢問：
   - 請給予精簡、溫暖且切合國小教育專業之回覆。

請直接繁體中文回答：`;

  const aiReply = callGeminiText(prompt);

  // 1. 處理臨時交辦追加
  const todoMatch = aiReply.match(/\[SAVE_TODO:(.*?)\]/);
  if (todoMatch && todoMatch[1]) {
    try {
      const todoObj = JSON.parse(todoMatch[1]);
      appendAdhocTaskToToday(todoObj.task, todoObj.period);
    } catch (e) {
      console.warn('解析臨時交辦失敗: ' + e);
    }
  }

  // 2. 處理突發事件記錄
  const incMatch = aiReply.match(/\[SAVE_INCIDENT:(.*?)\]/);
  if (incMatch && incMatch[1]) {
    try {
      const inc = JSON.parse(incMatch[1]);
      saveIncidentRecord({
        date: Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm'),
        student: inc.student || '班級學生',
        type: inc.type || '常規',
        description: inc.description || text,
        status: '追蹤中'
      });
    } catch (e) {
      console.warn('解析突發事件標記失敗: ' + e);
    }
  }

  const cleanReply = aiReply.replace(/\[SAVE_TODO:.*?\]/g, '').replace(/\[SAVE_INCIDENT:.*?\]/g, '').trim();
  replyTextMessage(replyToken, cleanReply);
}

/**
 * 將白天臨時交辦追加至今日待辦
 */
function appendAdhocTaskToToday(taskText, period) {
  const today = new Date();
  const todayStr = Utilities.formatDate(today, 'GMT+8', 'yyyy-MM-dd');
  const dayZh = getDayOfWeekZh(today.getDay());
  
  let currentPlan = getSavedPlan(todayStr) || '';
  const addition = `
⚡ 【臨時交辦 (${period || '今日'})】：${taskText}`;
  currentPlan += addition;
  
  saveTomorrowPlanToSheet(todayStr, dayZh, currentPlan);
}

// ======================== 【班費收支與帳簿計算】 ========================

function replyClassFeeSummary(replyToken) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.EXPENSES);
  
  const totalIncome = CONFIG.STUDENT_COUNT * CONFIG.CLASS_FEE_PER_STUDENT;
  let totalExpense = 0;
  let recentExpenses = [];

  if (sheet && sheet.getLastRow() > 1) {
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
    data.forEach(row => {
      const amt = Number(row[4]) || 0;
      totalExpense += amt;
    });

    // 取最新 3 筆
    const recents = data.slice(-3).reverse();
    recentExpenses = recents.map(r => `▫️ ${Utilities.formatDate(new Date(r[0]), 'GMT+8', 'MM/dd')} ${r[1]}：$${Number(r[4]).toLocaleString()} (${r[2]})`);
  }

  const balance = totalIncome - totalExpense;

  const msg = `💰 【班費收支總結算】\n` +
    `━━━━━━━━━━━━━━\n` +
    `▫️ 班級人數：${CONFIG.STUDENT_COUNT} 人\n` +
    `▫️ 每生收取：$${CONFIG.CLASS_FEE_PER_STUDENT} 元\n` +
    `💵 總應收班費：$${totalIncome.toLocaleString()} 元\n` +
    `💸 目前累計支出：$${totalExpense.toLocaleString()} 元\n` +
    `💰 目前剩餘結餘：$${balance.toLocaleString()} 元\n` +
    `━━━━━━━━━━━━━━\n` +
    `📌 【最新支出明細】：\n` +
    (recentExpenses.length > 0 ? recentExpenses.join('\n') : '目前尚無支出紀錄') +
    `\n\n💡 只要拍照傳送廠商收據或發票，我將自動辨識品項與金額入帳！`;

  replyTextMessage(replyToken, msg);
}

function calculateBalance() {
  const totalIncome = CONFIG.STUDENT_COUNT * CONFIG.CLASS_FEE_PER_STUDENT;
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.EXPENSES);
  let totalExpense = 0;
  if (sheet && sheet.getLastRow() > 1) {
    const data = sheet.getRange(2, 5, sheet.getLastRow() - 1, 1).getValues();
    data.forEach(r => totalExpense += (Number(r[0]) || 0));
  }
  return totalIncome - totalExpense;
}

function addExpenseRecord(record) {
  const ss = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, CONFIG.SHEETS.EXPENSES, ['日期', '品項內容', '支出分類', '廠商/店家', '金額', '備註']);
  sheet.appendRow([record.date, record.item, record.category, record.vendor, record.amount, record.note]);
}

function saveIncidentRecord(record) {
  const ss = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, CONFIG.SHEETS.INCIDENTS, ['發生時間', '相關學生', '事件分類', '事件詳情', '追蹤狀態', '後續回報']);
  sheet.appendRow([record.date, record.student, record.type, record.description, record.status, '']);
}

// ======================== 【課表與行事曆讀取工具】 ========================

function replyTodaySchedule(replyToken) {
  const today = new Date();
  const dayZh = getDayOfWeekZh(today.getDay());
  const todayStr = Utilities.formatDate(today, 'GMT+8', 'yyyy-MM-dd');

  const schedule = getScheduleByDay(dayZh);
  const calendarEvents = getCalendarEvents(todayStr);
  const plan = getSavedPlan(todayStr);
  const uniformNote = CONFIG.UNIFORMS[dayZh] || '便服';

  let msg = `📅 【今日課程與行事（${CONFIG.CLASS_NAME}·週${dayZh}）】\n` +
    `━━━━━━━━━━━━━━\n` +
    `👗 學生服裝：${uniformNote}\n` +
    `🏫 學校行事：${calendarEvents.length > 0 ? calendarEvents.join('、') : '今日無全校重大行事'}\n\n` +
    `⏰ 各節課程安排：\n`;

  if (schedule && schedule.length > 0) {
    schedule.forEach(s => {
      msg += `▫️ ${s.period}：${s.subject}（${s.type}）\n`;
    });
  } else {
    msg += `（尚未設定週${dayZh}課表）\n`;
  }

  if (plan) {
    msg += `\n📋 【客製化教學待辦】：\n${plan}`;
  }

  replyTextMessage(replyToken, msg);
}

function replyPreparationTips(replyToken) {
  const today = new Date();
  const dayZh = getDayOfWeekZh(today.getDay());
  const schedule = getScheduleByDay(dayZh);
  let mainSubjects = schedule.filter(s => s.type === '導師課').map(s => s.subject).join('、');

  const prompt = `你是一名【臺中市梧棲區中正國小四年級】教學輔導顧問，嚴格遵守【G4 Curriculum Review 全域三階漏斗審查】：
- 教科書版本：南一數學 4上、翰林國語 4上、康軒社會 4上、校本彈性梧風啟航
- 在地生活情境：臺中港海線、梧棲老街、高美濕地、九降風環境

今天星期${dayZh}，四年丙班導師今天的導師課有：【${mainSubjects || '國語、數學'}】。
請針對這幾門科目在 115 四上當前單元（南一數 ch04除法/ch05三角形角度；翰林國 L04攀爬夢想/L05月光下形式深究；康軒社 1-3家鄉地圖/地形氣候），提供 3 點「極度實用、符合認知負荷(CLT)、切中四年級典型迷思（如除法位值補零、三角形內角和、地圖圖例方位辨識）」的教學與常規小錦囊。
文字請在 250 字內，條列明確，絕不空談泛用理論。`;

  const tips = callGeminiText(prompt);
  replyTextMessage(replyToken, `💡 【四年丙班 (304) 快速備課小錦囊】\n━━━━━━━━━━━━━━\n${tips}`);
}

function getScheduleByDay(dayZh) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.SCHEDULE);
  if (!sheet || sheet.getLastRow() <= 1) {
    // 預設示範課表
    return [
      { period: '早自修 (07:50-08:40)', subject: '晨讀與聯絡簿', type: '導師課' },
      { period: '第一節 (08:45-09:25)', subject: '國語', type: '導師課' },
      { period: '第二節 (09:35-10:15)', subject: '數學', type: '導師課' },
      { period: '第三節 (10:30-11:10)', subject: '自然', type: '科任課' },
      { period: '第四節 (11:20-12:00)', subject: '社會', type: '導師課' },
      { period: '第五節 (13:30-14:10)', subject: '英語', type: '科任課' },
      { period: '第六節 (14:20-15:00)', subject: '健康與體育', type: '科任課' },
      { period: '第七節 (15:10-15:50)', subject: '綜合活動', type: '導師課' }
    ];
  }

  const data = sheet.getDataRange().getValues();
  // 欄位預期：[星期, 節次, 科目, 課型(導師課/科任課)]
  const filtered = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[0]).trim() === dayZh || String(row[0]).trim() === '週' + dayZh || String(row[0]).trim() === '星期' + dayZh) {
      filtered.push({
        period: row[1],
        subject: row[2],
        type: row[3] || '導師課'
      });
    }
  }
  return filtered;
}

function getCalendarEvents(dateStr) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.CALENDAR);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getDataRange().getValues();
  const events = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowDateStr = Utilities.formatDate(new Date(row[0]), 'GMT+8', 'yyyy-MM-dd');
    if (rowDateStr === dateStr) {
      events.push(row[1] + (row[2] ? ` (${row[2]})` : ''));
    }
  }
  return events;
}

function saveTomorrowPlanToSheet(dateStr, dayZh, planText) {
  const ss = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, CONFIG.SHEETS.TODOLIST, ['日期', '星期', '各節課待辦規劃', '產出時間']);
  sheet.appendRow([dateStr, dayZh, planText, new Date()]);
}

function getSavedPlan(dateStr) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.TODOLIST);
  if (!sheet || sheet.getLastRow() <= 1) return null;

  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    const rowDateStr = Utilities.formatDate(new Date(data[i][0]), 'GMT+8', 'yyyy-MM-dd');
    if (rowDateStr === dateStr) {
      return data[i][2];
    }
  }
  return null;
}

// ======================== 【儀表板資料封裝 (API)】 ========================

function getDashboardData() {
  const today = new Date();
  const todayStr = Utilities.formatDate(today, 'GMT+8', 'yyyy-MM-dd');
  const dayZh = getDayOfWeekZh(today.getDay());

  const totalIncome = CONFIG.STUDENT_COUNT * CONFIG.CLASS_FEE_PER_STUDENT;
  let totalExpense = 0;
  let expenses = [];
  let incidents = [];

  const ss = getSpreadsheet();

  // 1. 班費收支
  const expSheet = ss.getSheetByName(CONFIG.SHEETS.EXPENSES);
  if (expSheet && expSheet.getLastRow() > 1) {
    const data = expSheet.getRange(2, 1, expSheet.getLastRow() - 1, 6).getValues();
    expenses = data.map(r => {
      const amt = Number(r[4]) || 0;
      totalExpense += amt;
      return {
        date: Utilities.formatDate(new Date(r[0]), 'GMT+8', 'yyyy-MM-dd'),
        item: r[1],
        category: r[2],
        vendor: r[3],
        amount: amt,
        note: r[5]
      };
    }).reverse();
  }

  // 2. 突發事件
  const incSheet = ss.getSheetByName(CONFIG.SHEETS.INCIDENTS);
  if (incSheet && incSheet.getLastRow() > 1) {
    const data = incSheet.getRange(2, 1, incSheet.getLastRow() - 1, 6).getValues();
    incidents = data.map(r => ({
      time: Utilities.formatDate(new Date(r[0]), 'GMT+8', 'MM-dd HH:mm'),
      student: r[1],
      type: r[2],
      description: r[3],
      status: r[4]
    })).reverse();
  }

  // 3. 今日待辦
  const currentPlan = getSavedPlan(todayStr) || '今日尚未產生客製化節次待辦（可透過下班 RDQ 自動產出）';

  return {
    className: CONFIG.CLASS_NAME,
    today: todayStr,
    dayZh: dayZh,
    finance: {
      studentCount: CONFIG.STUDENT_COUNT,
      feePerStudent: CONFIG.CLASS_FEE_PER_STUDENT,
      totalIncome: totalIncome,
      totalExpense: totalExpense,
      balance: totalIncome - totalExpense
    },
    schedule: getScheduleByDay(dayZh),
    calendarEvents: getCalendarEvents(todayStr),
    todayPlan: currentPlan,
    recentExpenses: expenses.slice(0, 10),
    recentIncidents: incidents.slice(0, 10)
  };
}

// ======================== 【Gemini API 底層呼叫模組】 ========================

function callGeminiText(prompt) {
  const apiKey = CONFIG.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
    return '【提示】尚未設定 GEMINI_API_KEY，請至 Apps Script 專案設定中加入金鑰。';
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.4
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const res = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(res.getContentText());
  if (json.candidates && json.candidates[0].content.parts[0].text) {
    return json.candidates[0].content.parts[0].text.trim();
  }
  throw new Error('Gemini API 回應異常: ' + res.getContentText());
}

function callGeminiVision(base64Data, mimeType, prompt) {
  const apiKey = CONFIG.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Data
          }
        }
      ]
    }],
    generationConfig: {
      temperature: 0.2
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const res = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(res.getContentText());
  if (json.candidates && json.candidates[0].content.parts[0].text) {
    return json.candidates[0].content.parts[0].text.trim();
  }
  throw new Error('Gemini Vision API 回應異常: ' + res.getContentText());
}

// ======================== 【LINE Messaging API 工具模組】 ========================

function replyTextMessage(replyToken, text) {
  const url = 'https://api.line.me/v2/bot/message/reply';
  const payload = {
    replyToken: replyToken,
    messages: [{ type: 'text', text: text }]
  };
  callLineApi(url, payload);
}

function replyTextMessageWithQuickReply(replyToken, text, quickReplies) {
  const url = 'https://api.line.me/v2/bot/message/reply';
  const payload = {
    replyToken: replyToken,
    messages: [{
      type: 'text',
      text: text,
      quickReply: {
        items: quickReplies.map(item => ({
          type: 'action',
          action: {
            type: 'message',
            label: item.label,
            text: item.text
          }
        }))
      }
    }]
  };
  callLineApi(url, payload);
}

function pushMessage(toUserId, text) {
  if (!toUserId) return;
  const url = 'https://api.line.me/v2/bot/message/push';
  const payload = {
    to: toUserId,
    messages: [{ type: 'text', text: text }]
  };
  callLineApi(url, payload);
}

function pushMessageWithQuickReply(toUserId, text, quickReplies) {
  if (!toUserId) return;
  const url = 'https://api.line.me/v2/bot/message/push';
  const payload = {
    to: toUserId,
    messages: [{
      type: 'text',
      text: text,
      quickReply: {
        items: quickReplies.map(item => ({
          type: 'action',
          action: {
            type: 'message',
            label: item.label,
            text: item.text
          }
        }))
      }
    }]
  };
  callLineApi(url, payload);
}

function getLineMessageContent(messageId) {
  const token = SCRIPT_PROPERTIES.getProperty('CHANNEL_ACCESS_TOKEN') || CONFIG.CHANNEL_ACCESS_TOKEN;
  const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
  const options = {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + token
    },
    muteHttpExceptions: true
  };
  const res = UrlFetchApp.fetch(url, options);
  if (res.getResponseCode() === 200) {
    return res.getBlob();
  }
  console.error('取得 LINE 圖片失敗: ' + res.getContentText());
  return null;
}

function callLineApi(url, payload) {
  const token = SCRIPT_PROPERTIES.getProperty('CHANNEL_ACCESS_TOKEN') || CONFIG.CHANNEL_ACCESS_TOKEN;
  const options = {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  const res = UrlFetchApp.fetch(url, options);
  console.log(`LINE API 回應代碼 [${res.getResponseCode()}]: ${res.getContentText()}`);
}

// ======================== 【對話狀態機與暫存管理】 ========================

function getSessionState(userId) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.RDQ_STATE);
  if (!sheet || sheet.getLastRow() <= 1) return null;

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === userId) {
      return {
        state: String(data[i][1]),
        data: JSON.parse(data[i][2] || '{}'),
        updatedAt: data[i][3]
      };
    }
  }
  return null;
}

function saveSessionState(userId, state, stateData) {
  const ss = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, CONFIG.SHEETS.RDQ_STATE, ['UserId', 'State', 'DataJSON', 'UpdatedAt']);
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === userId) {
      sheet.getRange(i + 1, 2, 1, 3).setValues([[state, JSON.stringify(stateData), new Date()]]);
      return;
    }
  }
  sheet.appendRow([userId, state, JSON.stringify(stateData), new Date()]);
}

function clearSessionState(userId) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.RDQ_STATE);
  if (!sheet || sheet.getLastRow() <= 1) return;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === userId) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

function getRecentIncidents(dateStr) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.INCIDENTS);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const data = sheet.getDataRange().getValues();
  const incidents = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowDate = Utilities.formatDate(new Date(row[0]), 'GMT+8', 'yyyy-MM-dd');
    if (rowDate === dateStr) {
      incidents.push(`[${row[2] || '事件'}] ${row[1] || '學生'}：${row[3] || ''}`);
    }
  }
  return incidents;
}

// ======================== 【試算表 Helper 工具】 ========================

function getSpreadsheet() {
  // 自動綁定目前的 Google 試算表
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headers && headers.length > 0) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f3f4f6');
    }
  }
  return sheet;
}

function getDayOfWeekZh(dayIdx) {
  const days = ['日', '一', '二', '三', '四', '五', '六'];
  return days[dayIdx] || '一';
}

/**
 * 一鍵將「梧棲中正國小四年丙班（304班）真實課表」與「115學年度第一學期學校重大行事」寫入試算表
 */
function updateRealScheduleAndCalendar() {
  const ss = getSpreadsheet();
  
  // 1. 寫入四年丙班 (304) 真實課表
  const schedSheet = getOrCreateSheet(ss, CONFIG.SHEETS.SCHEDULE, ['星期', '節次', '科目', '課型']);
  schedSheet.clearContents();
  schedSheet.appendRow(['星期', '節次', '科目', '課型']);
  schedSheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#e0e7ff');

  const realSchedule = [
    // 星期一（班服，半天課，中午放學）
    ['一', '早自修 (07:50-08:40)', '晨讀與聯絡簿', '導師課'],
    ['一', '第一節 (08:45-09:25)', '數學', '導師課'],
    ['一', '第二節 (09:35-10:15)', '自然', '科任課'],
    ['一', '第三節 (10:30-11:10)', '體育', '科任課'],
    ['一', '第四節 (11:20-12:00)', '國語', '導師課'],
    
    // 星期二（運動服，全天課，15:50放學）
    ['二', '早自修 (07:50-08:40)', '全校升旗與晨光', '全校活動'],
    ['二', '第一節 (08:45-09:25)', '數學', '導師課'],
    ['二', '第二節 (09:35-10:15)', '國語', '導師課'],
    ['二', '第三節 (10:30-11:10)', '美勞', '科任課'],
    ['二', '第四節 (11:20-12:00)', '美勞', '科任課'],
    ['二', '第五節 (13:30-14:10)', '社會', '導師課'],
    ['二', '第六節 (14:20-15:00)', '國際新視野', '科任課'],
    ['二', '第七節 (15:10-15:50)', '社會', '導師課'],

    // 星期三（便服，半天課，中午放學）
    ['三', '早自修 (07:50-08:40)', '晨讀與作業訂正', '導師課'],
    ['三', '第一節 (08:45-09:25)', '國語', '導師課'],
    ['三', '第二節 (09:35-10:15)', '本土語', '科任課'],
    ['三', '第三節 (10:30-11:10)', '梧風啟航 (校本彈性)', '導師課'],
    ['三', '第四節 (11:20-12:00)', '社會', '導師課'],

    // 星期四（班服，全天課，15:50放學）
    ['四', '早自修 (07:50-08:40)', '晨讀與聯絡簿', '導師課'],
    ['四', '第一節 (08:45-09:25)', '數學', '導師課'],
    ['四', '第二節 (09:35-10:15)', '國語', '導師課'],
    ['四', '第三節 (10:30-11:10)', '自然', '科任課'],
    ['四', '第四節 (11:20-12:00)', '自然', '科任課'],
    ['四', '第五節 (13:30-14:10)', '綜合活動', '導師課'],
    ['四', '第六節 (14:20-15:00)', '綜合活動', '導師課'],
    ['四', '第七節 (15:10-15:50)', '體育', '科任課'],

    // 星期五（運動服，全天課，15:50放學）
    ['五', '早自修 (07:50-08:40)', '晨讀與週五大掃除', '導師課'],
    ['五', '第一節 (08:45-09:25)', '音樂', '科任課'],
    ['五', '第二節 (09:35-10:15)', '數學', '導師課'],
    ['五', '第三節 (10:30-11:10)', '英文', '科任課'],
    ['五', '第四節 (11:20-12:00)', '國語', '導師課'],
    ['五', '第五節 (13:30-14:10)', '閱讀 (彈性學習)', '導師課'],
    ['五', '第六節 (14:20-15:00)', '電腦資訊', '科任課'],
    ['五', '第七節 (15:10-15:50)', '健康', '科任課']
  ];
  schedSheet.getRange(2, 1, realSchedule.length, 4).setValues(realSchedule);

  // 2. 寫入 115 學年度第一學期重要行事曆 (33 項完整行事)
  const calSheet = getOrCreateSheet(ss, CONFIG.SHEETS.CALENDAR, ['日期', '行事名稱', '注意事項']);
  calSheet.clearContents();
  calSheet.appendRow(['日期', '行事名稱', '注意事項']);
  calSheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#fef3c7');

  const realCalendar = [
    ['2026-08-31', '開學日、課後照顧班與星光班開課', '正式開學註冊'],
    ['2026-09-14', '游泳課開始', '請學生備妥泳裝蛙鏡'],
    ['2026-09-16', '班親會', '親師座談與班級經營溝通'],
    ['2026-09-17', '防災演練、學習扶助開課', '上午全校演練避難動線'],
    ['2026-09-18', '學生慶生會 (九月)', '發放慶生祝福小禮物'],
    ['2026-09-21', '社團活動開始', '課後社團開始上課'],
    ['2026-09-25', '中秋節放假一日', '國定假日放假'],
    ['2026-09-28', '教師節放假一日', '國定假日放假'],
    ['2026-10-09', '國慶日調整放假', '連假調整'],
    ['2026-10-10', '雙十國慶日', '國定假日放假'],
    ['2026-10-16', '學生慶生會 (十月)', '十月份慶生活動'],
    ['2026-10-24', '校慶運動會', '全校體育運動大會'],
    ['2026-10-25', '光復節', '國定節日'],
    ['2026-10-26', '光復節調整放假', '連假調整'],
    ['2026-10-27', '校慶運動會補休一日', '全校運動會補假一日'],
    ['2026-11-05', '第一次定期評量 (期中考 Day 1)', '國語、自然、英文科定期評量'],
    ['2026-11-06', '第一次定期評量 (期中考 Day 2)', '數學、社會科定期評量'],
    ['2026-11-11', '家庭訪問', '親師實體或線上家庭訪問'],
    ['2026-11-20', '學生慶生會 (十一月)', '十一月份慶生活動'],
    ['2026-11-30', '戶外教育週開始 (暫定)', '校外教學參訪'],
    ['2026-12-04', '戶外教育週結束', '戶外教育心得整理'],
    ['2026-12-14', '社團活動結束週開始', '社團期末結業展示'],
    ['2026-12-18', '學生慶生會 (十二月)、社團結束', '慶生會與社團總結'],
    ['2026-12-25', '行憲紀念日放假一日', '國定假日放假'],
    ['2027-01-01', '元旦放假一日', '新年元旦假期'],
    ['2027-01-08', '學生慶生會 (一月)', '一月份慶生活動'],
    ['2027-01-12', '第二次定期評量 (期末考 Day 1)', '期末考評量首日'],
    ['2027-01-13', '第二次定期評量 (期末考 Day 2)', '期末考評量次日'],
    ['2027-01-14', '鴻海星光班結束、會長盃比賽', '星光班期末與體育競賽'],
    ['2027-01-15', '課後照顧班結束', '期末課後照顧班結束'],
    ['2027-01-20', '休業式', '第一學期結業典禮，提早放學'],
    ['2027-01-21', '寒假開始', '寒假開始'],
    ['2027-02-11', '第二學期開學日', '下學期正式開學上課']
  ];
  calSheet.getRange(2, 1, realCalendar.length, 3).setValues(realCalendar);

  console.log('✅ 四年丙班 (304) 真實課表（34節次）與 115學年度重大行事（33項）已全數更新完畢！');
}


/**
 * 處理導師「臨時改變進度」需求
 */
function handleProgressChange(userId, text, replyToken) {
  const isPromptOnly = (text === '臨時改變進度' || text === '改進度' || text === '調整進度' || text === '臨時改課');
  
  if (isPromptOnly) {
    const promptMsg = `⚡ 【臨時改變進度指引】\n━━━━━━━━━━━━━━\n老師，請問您想調整哪一節課的進度或更換科目？\n\n👉 您可以直接在此回傳，例如：\n▫️「第二節改上數學ch05三角形」\n▫️「第三節因下雨體育改教室自習」\n▫️「下午第五節綜合改訂正國隨」\n\n我會立即為您重新排定當日節次清單，並同步更新至個人儀表板！`;
    const quickReplies = [
      { label: '第二節改數學', text: '第二節改上數學' },
      { label: '第三節改國語', text: '第三節改上國語' },
      { label: '下午改自習', text: '下午改自習訂正' },
      { label: '取消調整', text: '今日行程' }
    ];
    replyTextMessageWithQuickReply(replyToken, promptMsg, quickReplies);
    return;
  }

  // 若使用者已輸入具體改動內容
  const today = new Date();
  const todayStr = Utilities.formatDate(today, 'GMT+8', 'yyyy-MM-dd');
  const dayZh = getDayOfWeekZh(today.getDay());
  const currentPlan = getSavedPlan(todayStr) || '今日常規課表';

  const prompt = `你是一名【臺中市梧棲區中正國小 四年丙班 (304班)】教學教務智慧助教。
今日日期：${todayStr} 週${dayZh}
目前已排定之各節次進度：
${currentPlan}

導師臨時提出的進度更動指示：
「${text}」

【任務要求】：
1. 根據導師的具體改動指示，精確調整對應節次的科目或進度。
2. 保持南一數、翰林國、康軒社、校本梧風啟航之版本規範，相鄰節次作適當配套調配。
3. 輸出更新後完整的【早自修至第七節 今日最新節次執行清單】，並在上方清楚標記【⚡ 今日進度已即時更新】！`;

  const updatedPlan = callGeminiText(prompt);
  saveTomorrowPlanToSheet(todayStr, dayZh, updatedPlan);

  replyTextMessage(replyToken, `⚡ 【今日進度已即時調整完成】\n━━━━━━━━━━━━━━\n${updatedPlan}\n━━━━━━━━━━━━━━\n💡 個人儀表板已同步即時更新！`);
}

/**
 * 處理導師「重新設計課程進度」需求
 */
function handleCurriculumRedesign(userId, text, replyToken) {
  const isPromptOnly = (text === '重新設計進度' || text === '重新設計課程進度' || text === '重排進度' || text === '重新規劃進度');
  
  const today = new Date();
  const todayStr = Utilities.formatDate(today, 'GMT+8', 'yyyy-MM-dd');

  const prompt = `你是一名專屬支援【臺中市梧棲區中正國小 四年丙班 (304班)】的資深教學規劃顧問。
嚴格遵守【G4 Curriculum Review 全域三階漏斗審查】：
- 教科書版本：南一數學 4上 (ch01-ch05)、翰林國語 4上 (L01-L06)、康軒社會 4上 (單元一、單元二)、校本梧風啟航
- 關鍵里程碑：11/05(四)-11/06(五) 第一次定期評量（期中考，距離約剩 10~14 天）
- 今日日期：${todayStr}

導師提出的重整需求/回饋：「${text}」

【任務要求】：
請為導師提出【三軌不同策略的進度重新設計藍圖】，供導師一鍵確認或輸入現有課次微調：

【藍圖 1：期中考前精準複習軌 (衝刺聚焦)】
- 主科（數 ch04/ch05、國 L04-L06）快速收尾，預留考前整整一週進行習作錯題演練與大表雙向細目診斷。

【藍圖 2：概念迷思扎根補救軌 (精緻穩健)】
- 放慢節奏，針對中年級易卡關迷思（除法位值補零、三角形內角與邊長、國語形式深究）每週增設 2 次晨光與課間補救。

【藍圖 3：跨域素養探究軌 (情境實作)】
- 將康軒社會家鄉地圖、高美濕地九降風與校本「梧風啟航」做主題式串接，兼顧學科知識與在地體驗。

請輸出結構清晰、條列分明的繁體中文藍圖方案，文末提示導師：「請直接點選下方按鈕採納方案，或直接回傳您目前各科具體教到的課次頁碼，我將為您建立專屬進度基準線！」`;

  const redesignPlan = callGeminiText(prompt);

  const quickReplies = [
    { label: '1️⃣ 採納期中考衝刺軌', text: '採納藍圖1：期中考衝刺軌' },
    { label: '2️⃣ 採納迷思補救軌', text: '採納藍圖2：迷思補救軌' },
    { label: '3️⃣ 採納跨域探究軌', text: '採納藍圖3：跨域探究軌' },
    { label: '✏️ 回報目前課次', text: '目前進度：' }
  ];

  replyTextMessageWithQuickReply(replyToken, `🔄 【課程進度重新設計提案】\n━━━━━━━━━━━━━━\n${redesignPlan}`, quickReplies);
}

// ======================== 【一鍵連線診斷工具】 ========================

/**
 * 測試 LINE 與 Gemini 金鑰是否正常連線
 */
function testLineBot() {
  const token = PropertiesService.getScriptProperties().getProperty('CHANNEL_ACCESS_TOKEN');
  const geminiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  
  console.log('--- 系統設定值檢查 ---');
  console.log('1. CHANNEL_ACCESS_TOKEN 狀態：' + (token ? `已讀取（前10碼: ${token.substring(0, 10)}...）` : '❌ 未讀取到，請檢查屬性名稱是否完全相符'));
  console.log('2. GEMINI_API_KEY 狀態：' + (geminiKey ? `已讀取（長度: ${geminiKey.length} 字元）` : '❌ 未讀取到'));

  if (!token) {
    console.error('請先至「專案設定」->「指令碼屬性」填寫 CHANNEL_ACCESS_TOKEN！');
    return;
  }

  // 測試呼叫 LINE API 檢查 Token 有效性
  const url = 'https://api.line.me/v2/bot/info';
  const options = {
    method: 'get',
    headers: { 'Authorization': 'Bearer ' + token.trim() },
    muteHttpExceptions: true
  };
  const res = UrlFetchApp.fetch(url, options);
  const code = res.getResponseCode();
  console.log('3. LINE 官方伺服器連線代碼：' + code);
  
  if (code === 200) {
    console.log('✅ LINE Token 驗證成功！機器人資訊：' + res.getContentText());
  } else if (code === 401) {
    console.error('❌ 驗證失敗 (401 Unauthorized)：請確認 Channel Access Token 是否複製完整，或重新在 LINE Developers 後台點 Issue 發行新 Token！');
  } else {
    console.error('⚠️ LINE API 回傳異常: ' + res.getContentText());
  }
}

/**
 * 系統初始化函式：一鍵建置所有工作表分頁與預設示範資料
 */
function initSystemSheets() {
  const ss = getSpreadsheet();
  
  // 1. 課表分頁
  const s1 = getOrCreateSheet(ss, CONFIG.SHEETS.SCHEDULE, ['星期', '節次', '科目', '課型']);
  if (s1.getLastRow() === 1) {
    const demoSchedule = [
      ['一', '早自修 (07:50-08:40)', '晨讀與聯絡簿', '導師課'],
      ['一', '第一節 (08:45-09:25)', '國語', '導師課'],
      ['一', '第二節 (09:35-10:15)', '數學', '導師課'],
      ['一', '第三節 (10:30-11:10)', '自然', '科任課'],
      ['一', '第四節 (11:20-12:00)', '社會', '導師課'],
      ['一', '第五節 (13:30-14:10)', '英語', '科任課'],
      ['一', '第六節 (14:20-15:00)', '體育', '科任課'],
      ['一', '第七節 (15:10-15:50)', '綜合活動', '導師課'],
      
      ['二', '早自修 (07:50-08:40)', '全校升旗', '全校活動'],
      ['二', '第一節 (08:45-09:25)', '數學', '導師課'],
      ['二', '第二節 (09:35-10:15)', '國語', '導師課'],
      ['二', '第三節 (10:30-11:10)', '本土語', '科任課'],
      ['二', '第四節 (11:20-12:00)', '資訊', '科任課'],
      ['二', '第五節 (13:30-14:10)', '藝美', '科任課'],
      ['二', '第六節 (14:20-15:00)', '藝音', '科任課'],
      ['二', '第七節 (15:10-15:50)', '彈性學習', '導師課']
    ];
    s1.getRange(2, 1, demoSchedule.length, 4).setValues(demoSchedule);
  }

  // 2. 行事曆分頁
  const s2 = getOrCreateSheet(ss, CONFIG.SHEETS.CALENDAR, ['日期', '行事名稱', '注意事項']);
  if (s2.getLastRow() === 1) {
    s2.appendRow(['2026-10-22', '四年級校外教學行前安全宣導', '第四節於活動中心集合']);
    s2.appendRow(['2026-10-27', '第一次定期評量審題會議', '繳交命題雙向細目表']);
  }

  // 3. 班費收支
  const s3 = getOrCreateSheet(ss, CONFIG.SHEETS.EXPENSES, ['日期', '品項內容', '支出分類', '廠商/店家', '金額', '備註']);
  
  // 4. 學生突發
  const s4 = getOrCreateSheet(ss, CONFIG.SHEETS.INCIDENTS, ['發生時間', '相關學生', '事件分類', '事件詳情', '追蹤狀態', '後續回報']);

  // 5. 每日待辦
  getOrCreateSheet(ss, CONFIG.SHEETS.TODOLIST, ['日期', '星期', '各節課待辦規劃', '產出時間']);

  // 6. RDQ 暫存
  getOrCreateSheet(ss, CONFIG.SHEETS.RDQ_STATE, ['UserId', 'Step', 'AnswersJSON', 'UpdatedAt']);

  console.log('✅ 系統資料庫各工作表已自動建置完畢！');
}
