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
  GEMINI_MODEL: SCRIPT_PROPERTIES.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash', // 預設使用 gemini-2.5-flash (備援 gemini-1.5-flash)

  // 班級基本設定 (RDQ 訪談確認值：28人，每人300元)
  STUDENT_COUNT: 28,
  CLASS_FEE_PER_STUDENT: 300,
  CLASS_NAME: '臺中市梧棲區中正國小 四年丙班 (304班)',

  // 教科書版本鎖定 (遵循 G4 Curriculum Review 全域審查規範，嚴禁跨版本混用)
  TEXTBOOKS: {
    MATH: '南一版 國小數學 4上（南一數，單元一：一億以內的數、單元二：乘法、單元三：角度、單元四：除法、單元五：三角形、加油小站一）',
    CHINESE: '翰林版 國小國語 4上（翰林國，L01美麗島、L02請到我的家鄉來、L03鏡頭下的家鄉、統整活動一、L04飛行夢、L05月光下、L06又遠又近的月亮、統整活動二）',
    SOCIAL: '康軒版 國小社會 4上（康軒社，第一單元：家鄉的自然環境、第二單元：家鄉的傳統住屋與器物）',
    LOCAL: '梧風啟航（梧棲海線校本彈性課程，結合臺中港、高美濕地、梧棲老街與海洋文化）'
  },

  // 真實教學進度基準線（依據 115 四上教材、雙向細目表與期中評量目標鎖定）
  CURRICULUM_PROGRESS: {
    UPDATED_AT: '2026-10-23',
    MATH: {
      textbook: '南一數 4上',
      scope: '單元一～五（P.6-P.75）',
      isCompleted: true,
      status: '✅ 期中考範圍已全數教完',
      strategy: '進入螺旋總複習、除法除數估商補零錯題診斷、三角形量角性質精熟與素養解題'
    },
    CHINESE: {
      textbook: '翰林國 4上',
      scope: '第 1~6 課、統整活動一、統整活動二',
      isCompleted: false,
      completedSummary: '第 1~5 課已教完；第 6 課《又遠又近的月亮》已完成前 3 段',
      pendingUnits: [
        '第 6 課《又遠又近的月亮》第四段（登月科技與省思、句型「就算…也…」）',
        '統整活動（一）（讀信與回信格式、審題立意拆解、朗讀詩歌節奏）',
        '統整活動（二）（六何法 5W1H、審題選材三步驟、讀報五大核心要素與阿提米絲新聞探索）'
      ],
      strategy: '下週依序攻堅第 6 課第四段、統整活動一、統整活動二，依雙向細目表精熟字音字形與閱讀理解'
    },
    SOCIAL: {
      textbook: '康軒社 4上',
      scope: '第一單元、第二單元',
      isCompleted: false,
      completedSummary: '第一單元《家鄉的自然環境》已全數教完',
      pendingUnits: [
        '第二單元《家鄉的傳統住屋與器物》全單元',
        '  - 2-1 傳統住屋與生活（三合院、土埆厝、石板屋、高腳屋與適應環境之就地取材智慧）',
        '  - 2-2 器物與生活（日常器物、竹編魚筌捕魚、陶甕石磨、生活器具演變）',
        '  - 小小探究家：器物大不同？'
      ],
      strategy: '把握下週二(2節)、週三(1節)與校本彈性課，完成第二單元教學與生活器物探究'
    },
    WRITING: {
      status: '⏳ 期中考前尚缺一篇作文',
      topic: '搭配統整活動二「我最敬佩的人」或「家鄉的一景」，引導審題、立意、選材並完成第 4 篇作文',
      schedule: '排定下週四（10/29）第 5、6 節綜合活動完成寫作與首稿；下週五第 5 節閱讀課謄稿互評'
    },
    PARENT_NOTICE_TASK: {
      deadline: '2026-10-30 (下週五)',
      task: '★ 製作「期中考前範圍圖」（圖文視覺海報），透過 LINE 官方帳號發送給 304 班家長',
      examDates: '2026-11-05 (四) ~ 2026-11-06 (五) 期中定期評量'
    }
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
    PROGRESS: '教學進度',
    RDQ_STATE: 'RDQ暫存'
  }
};

/**
 * 安全日期格式化工具：防止 null、undefined、空字串或無效日期導致 Utilities.formatDate 拋出異常中斷
 */
function safeFormatDate(val, format) {
  if (val === null || val === undefined || val === '') return '';
  try {
    const d = (val instanceof Date) ? val : new Date(val);
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, 'GMT+8', format || 'yyyy-MM-dd');
  } catch (e) {
    return '';
  }
}

/**
 * 取得導師 LINE User ID（具備三重容錯與自動修復）
 * 1. 優先從 ScriptProperties 讀取
 * 2. 次從 CONFIG 快取讀取
 * 3. 自 RDQ_STATE 工作表自動恢復過往互動記錄之 User ID
 */
function getTeacherUserId() {
  let id = SCRIPT_PROPERTIES.getProperty('TEACHER_USER_ID');
  if (id && String(id).trim().startsWith('U')) return String(id).trim();

  if (CONFIG.TEACHER_USER_ID && String(CONFIG.TEACHER_USER_ID).trim().startsWith('U')) {
    return String(CONFIG.TEACHER_USER_ID).trim();
  }

  // 自動自 RDQ_STATE 試算表恢復導師 ID
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.RDQ_STATE);
    if (sheet && sheet.getLastRow() > 1) {
      const data = sheet.getDataRange().getValues();
      for (let i = data.length - 1; i >= 1; i--) {
        const val = String(data[i][0] || '').trim();
        if (val.startsWith('U') && val.length > 20) {
          SCRIPT_PROPERTIES.setProperty('TEACHER_USER_ID', val);
          CONFIG.TEACHER_USER_ID = val;
          console.log('✅ 自動自 RDQ_STATE 恢復並綁定導師 User ID: ' + val);
          return val;
        }
      }
    }
  } catch (e) {
    console.warn('嘗試自 RDQ_STATE 恢復 User ID 失敗: ' + e);
  }

  return '';
}

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

      // 自動記錄或更新導師的 User ID（只要是以 U 開頭的標準 LINE User ID）
      if (userId && String(userId).startsWith('U')) {
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

    // 優先檢查圖文選單與頂層關鍵指令（絕不被狀態機卡住）
    const commandList = [
      '今日行程', '今日課表',
      '下班復盤', '下班RDQ', '開始復盤', '晚間復盤',
      '預先規劃下個上課日', '預先規劃', '預排行程', '預排進度',
      '晨間安排', '晨間建議',
      '綁定推播', '設定推播', '測試推播', '檢查推播', '重設觸發條件',
      '臨時改變進度', '改進度', '調整進度', '臨時改課',
      '重新設計進度', '重新設計課程進度', '重排進度', '重新規劃進度',
      '班費收支', '班費結餘',
      '學生突發', '學生事件',
      '快速備課', '備課指引', '備課錦囊', '備課', '我要備課', '數學備課', '國語備課', '社會備課', '作文備課', '期中考前範圍圖', '考前範圍海報', '考前範圍',
      '個人儀表板', '開啟儀表板',
      '重置狀態', '重置復盤'
    ];

    if (!commandList.includes(text)) {
      // 只有在非頂層指令時，才檢查是否處於待確認狀態
      const session = getSessionState(userId);
      if (session) {
        if (session.state === 'EVENING_STEP_BY_STEP') {
          handleStepByStepReviewReply(userId, text, replyToken);
          return;
        }
        if (session.state === 'MORNING_PENDING') {
          handleMorningConfirmation(userId, text, replyToken);
          return;
        }
        if (session.state === 'EVENING_PENDING') {
          handleEveningConfirmation(userId, text, replyToken);
          return;
        }
      }
    } else {
      // 若點選頂層指令，重置當前狀態以防衝突
      clearSessionState(userId);
    }

    // 圖文選單與關鍵字分流
    switch (text) {
      case '今日行程':
      case '今日課表':
        replyTodaySchedule(replyToken, userId);
        break;

      case '下班復盤':
      case '下班RDQ':
      case '開始復盤':
      case '晚間復盤':
        triggerEveningInteractiveReview(userId, replyToken);
        break;

      case '預先規劃下個上課日':
      case '預先規劃':
      case '預排行程':
      case '預排進度':
        triggerEveningInteractiveReview(userId, replyToken, true);
        break;

      case '晨間安排':
      case '晨間建議':
        sendMorningInteractiveBriefing();
        break;

      case '綁定推播':
      case '設定推播':
      case '測試推播':
      case '檢查推播':
      case '重設觸發條件':
        handleTriggerSetupCommand(userId, replyToken);
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
      case '備課錦囊':
      case '備課':
      case '我要備課':
      case '數學備課':
      case '國語備課':
      case '社會備課':
      case '作文備課':
      case '期中考前範圍圖':
      case '考前範圍海報':
      case '考前範圍':
        replyPreparationTips(replyToken, text);
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
        // 若輸入包含備課、教案或考前範圍，直接調用實戰即用型快速備課神器
        if (text.includes('備課') || text.includes('教案') || text.includes('考前範圍') || text.includes('範圍圖')) {
          replyPreparationTips(replyToken, text);
          break;
        }

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

function getCurriculumPromptContext() {
  return `
【目前 304 班真實最新教學進度基準線（請嚴格據此設計每一節課的建議，切勿脫離現況）】：
- 📘 數學（南一 4上）：期中考範圍（單元一～五：一億以內的數、乘法、角度、除法、三角形）已全數教完！
  * 當前教學重點：進入期中考前螺旋總複習、典型迷思補救（除法估商補零、等腰正三角形內角和、大數計算精熟）與高層次素養應用題。
- 📙 國語（翰林 4上）：第 1~5 課已全數教完，第 6 課《又遠又近的月亮》已教前 3 段。目前【尚未教學】之單元為：
  1. 第 6 課《又遠又近的月亮》第四段（登月科技與省思、句型「就算…也…」）
  2. 統整活動（一）（讀信與回信格式、審題立意拆解、朗讀詩歌節奏）
  3. 統整活動（二）（六何法 5W1H、審題選材三步驟、讀報五大核心要素與阿提米絲新聞探索）
- 📗 社會（康軒 4上）：第一單元《家鄉的自然環境》已全數教完。目前【尚未教學】之單元為：
  第二單元《家鄉的傳統住屋與器物》全單元（2-1 傳統住屋與生活、2-2 器物與生活、小小探究家：器物大不同）
- ✍️ 作文：本學期期中前【尚缺一篇作文】，規劃結合統整活動二「我最敬佩的人」或家鄉在地書寫完成。
- 🎯 重要里程碑提醒：【下週五 2026-10-30】必須製作「期中考前範圍圖」透過 LINE 官方帳號推播給家長！期中考日期為 11/05~11/06。`;
}

/**
 * 每日 06:30 晨間推播：結合今日課表、行事曆與昨夜復盤，主動提出 3 個安排方案供導師點選與確認臨時交辦
 */
function sendMorningInteractiveBriefing() {
  const teacherId = getTeacherUserId();
  if (!teacherId) {
    console.warn('尚未記錄導師 User ID，無法發送 06:30 晨間推播。請在 LINE 輸入「綁定推播」或在 GAS 執行 setupDailyTriggers。');
    return;
  }

  const today = new Date();
  const todayInfo = getDateHolidayInfo(today);

  // 結合國定假日、週末與學校補休校驗：若非正式上課日則跳過推播
  if (!todayInfo.isSchoolDay) {
    console.info(`今日為放假日（${todayInfo.reason}），跳過 06:30 晨間課堂推播。`);
    return;
  }

  const dayOfWeek = today.getDay();
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

${getCurriculumPromptContext()}

今天是 ${todayStr} 星期${dayZh}。
服裝與放學規定：${uniformNote}
今日課表節次：
${JSON.stringify(schedule, null, 2)}
今日學校重大行事：${calendarEvents.length > 0 ? calendarEvents.join('、') : '常規教學日，無全校重大集會'}
昨晚 20:00 復盤產出之初步規劃基底：
${yesterdayPlan || '無前置待辦記錄，按表操課'}

【重要核心要求 - 每一節課皆提供三種具體建議】：
導師要的不是空泛問句，而是【精確到每一節課都提供 3 種具體建議方案供他直接點選或組合】，並具備隨時臨時改進度與重新設計進度的彈性！
請依據上述南一數（已教完進入複習）、翰林國（未教第6課第四段與統整活動一二）、康軒社（未教第二單元）、作文與今日課表，針對【早自修至第七節、放學】的每一節課，皆給予 3 種精確切合當前進度的備選安排：
- [A] 標準進度：南一數複習精熟/翰林國未教單元講授/康軒社第二單元核心概念與例題引導。
- [B] 習作補救：課堂實作、習作批閱演練、針對四年級典型迷思（除法位值/角度測量/生字部件/住屋器物分類）補救。
- [C] 在地探究：結合梧棲海線生活情境（臺中港、高美濕地、九降風、梧棲老街傳統住屋）之生活化應用、小組討論或多元評量。
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

  let proposalText = '';
  try {
    proposalText = callGeminiText(prompt);
  } catch (err) {
    console.warn('Gemini 晨間建議生成失敗，切換為本地結構化備援卡片: ' + err.toString());
    let fallbackLines = [
      `☀️ 【今日課堂總覽（${CONFIG.CLASS_NAME}·週${dayZh}）】`,
      `👗 學生服裝：${uniformNote}`,
      `🏫 學校行事：${calendarEvents.length > 0 ? calendarEvents.join('、') : '今日常規教學，無重大集會'}`,
      `━━━━━━━━━━━━━━`,
      `⏰ 【今日各節次建議方案】：`
    ];
    for (let i = 0; i < schedule.length; i++) {
      const p = schedule[i];
      const card = getPeriodReviewCard(p, i, schedule.length, dayZh, todayStr, []);
      const icon = card.isHomeroom ? (card.periodName.includes('早自修') ? '☀️' : '📘') : '☕';
      const label = card.isHomeroom ? '' : '（科任課・導師空白時間）';
      fallbackLines.push(`${icon} ${card.periodName} - ${card.subject}${label}：\n   [A] ${card.options['A']}\n   [B] ${card.options['B']}\n   [C] ${card.options['C']}`);
    }
    fallbackLines.push(`━━━━━━━━━━━━━━\n💡 您可回傳「全選A」、「全選B」或輸入客製微調！`);
    proposalText = fallbackLines.join('\n\n');
  }

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
 * 判斷該節課是否為導師親授科目
 * 依使用者規範：只要是 國、數、社、綜合、電腦、梧風起航（含晨讀、早自修）即為導師課
 * 其他科目（自然、體育、音樂、美勞、英文、健康、本土語等）均為科任課
 */
function isHomeroomSubject(subject) {
  if (!subject) return false;
  const s = String(subject).trim();
  const homeroomList = ['國', '數', '社', '綜合', '電腦', '資訊', '梧風', '晨讀', '早自修', '導師'];
  return homeroomList.some(h => s.includes(h));
}

/**
 * 將中文節次字串或代號解析為課表 schedule 中的 index
 */
function parsePeriodIndex(str, schedule) {
  if (!str) return -1;
  const s = String(str).trim();
  if (s.includes('早') || s.includes('晨')) {
    const idx = schedule.findIndex(item => item.period.includes('早自修') || item.period.includes('晨') || item.period.includes('早'));
    return idx !== -1 ? idx : 0;
  }
  const numMap = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7,
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7
  };
  const match = s.match(/([一二三四五六七1-7])/);
  if (match) {
    const periodNum = numMap[match[1]];
    const idx = schedule.findIndex(item => item.period.includes(`第${periodNum}節`) || item.period.includes(`${match[1]}`));
    return idx !== -1 ? idx : periodNum;
  }
  return -1;
}

/**
 * 跨節識別引擎：
 * 自動識別導師輸入的跨節/多節安排（如「早自習到第二節需要運動會預演」、「第1-2節健檢」、「上午都在操場預演」）
 * 回傳：{ isSpan: boolean, coveredIndices: number[], activityName: string, coveredPeriodsText: string }
 */
function analyzePeriodSpan(text, currentIndex, schedule) {
  if (!text || typeof text !== 'string') return { isSpan: false };
  const clean = text.trim();

  // 1. 識別明確起迄節次：
  // "早自習到第二節需要運動會預演"、"早自修至第2節操場彩排"、"第1節到第2節運動會預演"、"1-2節健檢"、"早自習和第一節拔河比賽"
  const spanRangeRegex = /(?:從)?\s*(早自習|早自修|晨讀|晨會|第?[一二三四五六七1-7]節?)\s*(?:到|至|～|~|-|和|與|跟|及)\s*(?:第)?([一二三四五六七1-7]|早自習|早自修|晨讀|晨會)節?/i;
  const rangeMatch = clean.match(spanRangeRegex);

  if (rangeMatch) {
    let startIdx = parsePeriodIndex(rangeMatch[1], schedule);
    let endIdx = parsePeriodIndex(rangeMatch[2], schedule);

    if (startIdx === -1) startIdx = currentIndex;
    if (endIdx !== -1 && endIdx >= startIdx) {
      const coveredIndices = [];
      for (let i = startIdx; i <= Math.min(endIdx, schedule.length - 1); i++) {
        coveredIndices.push(i);
      }

      let activity = clean.replace(rangeMatch[0], '').trim();
      activity = activity.replace(/^(需要|進行|要|排|是|要進行|全部|都在|改為|改|安排|在操場|在禮堂)\s*/, '').trim();
      if (!activity) activity = '跨節專案活動';

      const coveredPeriodNames = coveredIndices.map(idx => schedule[idx].period);
      return {
        isSpan: true,
        coveredIndices: coveredIndices,
        activityName: activity,
        coveredPeriodsText: coveredPeriodNames.join('、')
      };
    }
  }

  // 2. 連續節次詞：「連兩節」、「連續兩節」、「連2節」、「連三節」
  const continuousMatch = clean.match(/(?:連|連續)\s*([兩二2三3四4])\s*節/);
  if (continuousMatch) {
    const countMap = { '兩': 2, '二': 2, '2': 2, '三': 3, '3': 3, '四': 4, '4': 4 };
    const count = countMap[continuousMatch[1]] || 2;
    const coveredIndices = [];
    for (let i = currentIndex; i < Math.min(currentIndex + count, schedule.length); i++) {
      coveredIndices.push(i);
    }
    if (coveredIndices.length > 1) {
      let activity = clean.replace(continuousMatch[0], '').trim();
      activity = activity.replace(/^(需要|進行|要|排|是|要進行|都在|安排)\s*/, '').trim();
      if (!activity) activity = '連續課程活動';
      const coveredPeriodNames = coveredIndices.map(idx => schedule[idx].period);
      return {
        isSpan: true,
        coveredIndices: coveredIndices,
        activityName: activity,
        coveredPeriodsText: coveredPeriodNames.join('、')
      };
    }
  }

  // 3. 時段詞識別：「上午/早上/上半天」、「下午/下半天」
  if (/^(上午|早上|上半天)/i.test(clean)) {
    const coveredIndices = [];
    for (let i = 0; i < Math.min(5, schedule.length); i++) {
      if (i >= currentIndex) coveredIndices.push(i);
    }
    if (coveredIndices.length > 1) {
      let activity = clean.replace(/^(上午|早上|上半天)\s*(都在|要進行|要|進行|是|全部|安排)?\s*/i, '').trim();
      if (!activity) activity = '上午專案活動';
      const coveredPeriodNames = coveredIndices.map(idx => schedule[idx].period);
      return {
        isSpan: true,
        coveredIndices: coveredIndices,
        activityName: activity,
        coveredPeriodsText: coveredPeriodNames.join('、')
      };
    }
  }

  if (/^(下午|下半天)/i.test(clean)) {
    const coveredIndices = [];
    for (let i = 5; i < schedule.length; i++) {
      if (i >= currentIndex) coveredIndices.push(i);
    }
    if (coveredIndices.length > 1) {
      let activity = clean.replace(/^(下午|下半天)\s*(都在|要進行|要|進行|是|全部|安排)?\s*/i, '').trim();
      if (!activity) activity = '下午專案活動';
      const coveredPeriodNames = coveredIndices.map(idx => schedule[idx].period);
      return {
        isSpan: true,
        coveredIndices: coveredIndices,
        activityName: activity,
        coveredPeriodsText: coveredPeriodNames.join('、')
      };
    }
  }

  return { isSpan: false };
}

/**
 * 分析已確認排程脈絡（answersSoFar）：
 * 提取戶外/預演、測驗、作文等特殊活動狀態，供後續節次生成具備連貫邏輯之教學或空堂待辦建議
 */
function analyzePreviousContext(answersSoFar) {
  if (!answersSoFar || answersSoFar.length === 0) {
    return {
      hasOutdoor: false,
      hasExam: false,
      hasWriting: false,
      lastAnswer: null,
      contextNote: ''
    };
  }

  const allChoices = answersSoFar.map(a => a.choice).join(' ');
  const hasOutdoor = /(預演|彩排|運動會|操場|大隊接力|拔河|體育|戶外|健檢)/i.test(allChoices);
  const hasExam = /(段考|月考|定期評量|試卷|雙向細目|考卷|小考|複習考)/i.test(allChoices);
  const hasWriting = /(作文|寫作|稿紙|我最敬佩的人)/i.test(allChoices);

  const lastAnswer = answersSoFar[answersSoFar.length - 1];
  let contextNote = '';

  if (lastAnswer) {
    if (/(預演|彩排|運動會|操場|大隊接力|拔河)/i.test(lastAnswer.choice)) {
      contextNote = `🏃 前一活動為【${lastAnswer.period} ${lastAnswer.choice}】，學生體力消耗大、易浮躁口渴`;
    } else if (/(作文|寫作)/i.test(lastAnswer.choice)) {
      contextNote = `✍️ 前一節已進行【${lastAnswer.period} 作文撰寫】`;
    } else if (/(段考|試卷|考卷)/i.test(lastAnswer.choice)) {
      contextNote = `📝 前一節已進行【${lastAnswer.period} 測驗評量】`;
    }
  }

  return {
    hasOutdoor,
    hasExam,
    hasWriting,
    lastAnswer,
    contextNote
  };
}

/**
 * 依節次與科目生成單節復盤卡片（具備前後連貫邏輯脈絡感知）
 * - 導師課（國數社綜合電腦梧風）：給出三種切合真實教材進度之教學建議，並融入前後節次調適
 * - 科任課（其他所有科目）：不給教學建議，轉為【導師空白時間・空堂備課待辦】，依前段活動連貫推薦
 */
function getPeriodReviewCard(periodItem, index, total, targetDayZh, targetDateStr, answersSoFar) {
  const periodName = periodItem.period || `第${index + 1}節`;
  const subject = periodItem.subject || '課程';
  const isHomeroom = isHomeroomSubject(subject);
  const prevCtx = analyzePreviousContext(answersSoFar || []);

  if (!isHomeroom) {
    // 【科任課・導師空白時間】
    const title = `☕ 【第 ${index + 1}/${total} 節：${periodName} - ${subject}（科任課・導師空白時間）】`;
    let desc = `🔔 此節為科任課，導師享有 40 分鐘空堂備課時間！\n`;
    if (prevCtx.contextNote) {
      desc += `📌 連貫情境：${prevCtx.contextNote}。\n`;
    }
    desc += `建議可利用此段空白時間處理以下班務待辦：\n\n`;

    let optA = '批閱作業：批改今日數習、生字簿或隨堂演練，標記學生錯題';
    let optB = '班務親師：整理班費發票收據自動記帳、聯繫個別學生家長';
    let optC = '備課印卷：準備下一節教材教具、列印期中考雙向細目複習卷';

    // 依前節脈絡動態調適
    if (prevCtx.hasOutdoor) {
      optB = '身心關懷：督導剛從操場/預演回班學生充分補充水分、調息靜心，整理班務單據';
    } else if (prevCtx.hasWriting) {
      optA = '批閱作文：初閱學生剛完成之「我最敬佩的人」作文首稿，標註佳作與錯字';
    } else if (prevCtx.hasExam) {
      optA = '批閱試卷：批改剛完成之雙向細目卷/隨堂測驗，即時統計錯題分布';
    }

    desc += `[A] ${optA}\n` +
      `[B] ${optB}\n` +
      `[C] ${optC}\n\n` +
      `👉 請點選建議，或直接輸入自訂待辦事項：`;

    return {
      isHomeroom: false,
      periodName: periodName,
      subject: subject,
      title: title,
      fullText: `${title}\n━━━━━━━━━━━━━━\n${desc}`,
      options: {
        'A': optA,
        'B': optB,
        'C': optC
      },
      quickReplies: [
        { label: '✏️ A 批改作業', text: 'A 批改作業' },
        { label: '📞 B 班務親師', text: 'B 班務親師' },
        { label: '🖨️ C 備課印卷', text: 'C 備課印卷' },
        { label: '⏩ 下一節', text: '下一節' },
        { label: '⚡ 全部照常', text: '全部照常' }
      ]
    };
  }

  // 【導師親授科目】
  let title = `📘 【第 ${index + 1}/${total} 節：${periodName} - ${subject}（導師授課）】`;
  let desc = '';
  let options = {};
  let quickReplies = [];

  const contextPrefix = prevCtx.contextNote ? `📌 前後連貫情境：${prevCtx.contextNote}（建議本節先引導飲水靜心再展開教學）。\n\n` : '';

  const s = String(subject).trim();
  if (s.includes('早自修') || s.includes('晨讀')) {
    title = `☀️ 【第 ${index + 1}/${total} 節：${periodName} - ${subject}（導師時間）】`;
    desc = `晨間常規與身心關懷：\n\n` +
      `[A] 常規晨讀：檢查聯絡簿簽名、收取作業、引導自主閱讀\n` +
      `[B] 迷思補救：除法估商或國語生字錯題個別輔導訂正\n` +
      `[C] 在地共讀：共讀梧棲海線文史短篇或阿提米絲科普讀報\n\n` +
      `👉 請點選建議，或直接輸入自訂交代：`;
    options = {
      'A': '常規晨讀（聯絡簿簽核、作業收取、晨讀引導）',
      'B': '迷思補救（除法估商或國語生字個別輔導訂正）',
      'C': '在地共讀（梧棲海線文史短篇或月球科普讀報）'
    };
    quickReplies = [
      { label: '📖 A 常規晨讀', text: 'A 常規晨讀' },
      { label: '💡 B 迷思補救', text: 'B 迷思補救' },
      { label: '🌊 C 在地共讀', text: 'C 在地共讀' },
      { label: '⏩ 下一節', text: '下一節' },
      { label: '⚡ 全部照常', text: '全部照常' }
    ];
  } else if (s.includes('國')) {
    title = `📘 【第 ${index + 1}/${total} 節：${periodName} - 國語（導師授課）】`;
    desc = contextPrefix +
      `當前進度：第6課未教第四段、統整一二未教、尚缺一篇作文。\n建議教學方案：\n\n` +
      `[A] 標準進度：精讀第6課《又遠又近的月亮》第四段科技省思與句型「就算…也…」\n` +
      `[B] 統整活動：拆解統整（一）讀信格式與朗讀節奏 / 統整（二）讀報五要素\n` +
      `[C] 作文引導：搭配統整活動二「我最敬佩的人/家鄉一景」審題立意，補足期中作文\n\n` +
      `👉 請點選建議，或直接輸入自訂進度：`;
    options = {
      'A': '精讀第6課《又遠又近的月亮》第四段科技省思與句型「就算…也…」',
      'B': '統整活動（一）讀信格式與朗讀節奏 / 統整（二）讀報五要素拆解',
      'C': '搭配統整活動二「我最敬佩的人/家鄉一景」審題立意，完成期中作文'
    };
    quickReplies = [
      { label: '📖 A 標準進度', text: 'A 標準進度' },
      { label: '📋 B 統整活動', text: 'B 統整活動' },
      { label: '✍️ C 作文引導', text: 'C 作文引導' },
      { label: '⏩ 下一節', text: '下一節' },
      { label: '⚡ 全部照常', text: '全部照常' }
    ];
  } else if (s.includes('數')) {
    title = `📘 【第 ${index + 1}/${total} 節：${periodName} - 數學（導師授課）】`;
    const mathFocusA = prevCtx.hasOutdoor ?
      '靜心總複習：除法二位數除以二位數/三位數除以二位數之試商精熟（平穩沉澱）' :
      '除法二位數除以二位數/三位數除以二位數之試商精練與總複習';
    desc = contextPrefix +
      `當前進度：期中考範圍（單元一～五）已全數教完，進行螺旋總複習。\n建議教學方案：\n\n` +
      `[A] 總複習精熟：${mathFocusA}\n` +
      `[B] 迷思補救：除法估商補零退位診斷、三角形等腰與角度量測性質補救\n` +
      `[C] 生活素養題：結合臺中港貨櫃裝載、拍賣數量之大數乘除混合應用\n\n` +
      `👉 請點選建議，或直接輸入自訂進度：`;
    options = {
      'A': mathFocusA,
      'B': '除法估商補零退位診斷、三角形等腰與角度量測性質易錯題補救',
      'C': '結合臺中港貨櫃裝載、漁獲拍賣之大數乘除生活素養題探究'
    };
    quickReplies = [
      { label: '🎯 A 總複習精熟', text: 'A 總複習精熟' },
      { label: '🔍 B 迷思補救', text: 'B 迷思補救' },
      { label: '🚢 C 生活素養題', text: 'C 生活素養題' },
      { label: '⏩ 下一節', text: '下一節' },
      { label: '⚡ 全部照常', text: '全部照常' }
    ];
  } else if (s.includes('社')) {
    title = `📗 【第 ${index + 1}/${total} 節：${periodName} - 社會（導師授課）】`;
    desc = contextPrefix +
      `當前進度：第一單元已教完，未教第二單元《家鄉的傳統住屋與器物》。\n建議教學方案：\n\n` +
      `[A] 2-1 傳統住屋：導讀三合院、土埆厝、石板屋與就地取材之環境智慧\n` +
      `[B] 2-2 生活器物：傳統器物與生活演變（竹編魚筌捕魚、陶甕石磨、火籠）\n` +
      `[C] 梧棲老街探究：連結梧棲老街傳統街屋建築與早期海線常民器物\n\n` +
      `👉 請點選建議，或直接輸入自訂進度：`;
    options = {
      'A': '2-1 導讀三合院、土埆厝、石板屋與就地取材之環境智慧',
      'B': '2-2 傳統器物與生活演變（竹編魚筌捕魚、陶甕石磨、火籠演進）',
      'C': '連結梧棲老街傳統閩南街屋建築與早期海線常民器物現地探究'
    };
    quickReplies = [
      { label: '🏠 A 傳統住屋', text: 'A 傳統住屋' },
      { label: '🏺 B 生活器物', text: 'B 生活器物' },
      { label: '🏮 C 老街探究', text: 'C 老街探究' },
      { label: '⏩ 下一節', text: '下一節' },
      { label: '⚡ 全部照常', text: '全部照常' }
    ];
  } else if (s.includes('綜合')) {
    title = `💻 【第 ${index + 1}/${total} 節：${periodName} - 綜合活動（導師授課）】`;
    desc = contextPrefix +
      `建議教學方案：\n\n` +
      `[A] 標準進度：生活自主與班級自治主題探究實作\n` +
      `[B] 期中作文補足：引導「我最敬佩的人」作文首稿撰寫\n` +
      `[C] 梧風海線主題：探究海線高美濕地生態保育與永續生活\n\n` +
      `👉 請點選建議，或直接輸入自訂進度：`;
    options = {
      'A': '綜合活動生活自主與班級自治主題探究實作',
      'B': '期中作文補足：引導「我最敬佩的人」作文構思與寫作',
      'C': '高美濕地生態保育與海洋廢棄物減量倡議探究'
    };
    quickReplies = [
      { label: '🌟 A 標準進度', text: 'A 標準進度' },
      { label: '✍️ B 作文補足', text: 'B 作文補足' },
      { label: '🌊 C 梧風主題', text: 'C 梧風主題' },
      { label: '⏩ 下一節', text: '下一節' },
      { label: '⚡ 全部照常', text: '全部照常' }
    ];
  } else if (s.includes('電腦') || s.includes('資訊')) {
    title = `💻 【第 ${index + 1}/${total} 節：${periodName} - 電腦資訊（導師授課）】`;
    desc = contextPrefix +
      `建議教學方案：\n\n` +
      `[A] 數位素養：資訊倫理、中打練習與簡報製作基礎\n` +
      `[B] 跨域應用：使用平板進行國語阿提米絲月球新聞資料檢索\n` +
      `[C] 數位評量：PaGamO 數學期中考除法與角度複習任務\n\n` +
      `👉 請點選建議，或直接輸入自訂進度：`;
    options = {
      'A': '資訊倫理與簡報排版基礎練習',
      'B': '平板操作：阿提米絲新聞與月球科學資料檢索',
      'C': 'PaGamO 數學除法與三角形螺旋複習任務'
    };
    quickReplies = [
      { label: '💻 A 數位素養', text: 'A 數位素養' },
      { label: '🔍 B 跨域檢索', text: 'B 跨域檢索' },
      { label: '🎮 C PaGamO複習', text: 'C PaGamO複習' },
      { label: '⏩ 下一節', text: '下一節' },
      { label: '⚡ 全部照常', text: '全部照常' }
    ];
  } else if (s.includes('梧風') || s.includes('校本') || s.includes('彈性')) {
    title = `🌊 【第 ${index + 1}/${total} 節：${periodName} - 梧風啟航（導師授課）】`;
    desc = contextPrefix +
      `校本彈性課程建議方案：\n\n` +
      `[A] 梧風起航：臺中港區現代物流與國際海港發展史\n` +
      `[B] 九降風探究：認識海線九降風特色與傳統曬魚、防風智慧\n` +
      `[C] 高美濕地：濕地動植物生態與海堤風車地景探究\n\n` +
      `👉 請點選建議，或直接輸入自訂進度：`;
    options = {
      'A': '梧風啟航：臺中港區現代物流與國際海港發展史',
      'B': '海線九降風氣候特色與防風生活智慧探究',
      'C': '高美濕地生態地景與潮間帶生物保護探究'
    };
    quickReplies = [
      { label: '🚢 A 臺中港區', text: 'A 臺中港區' },
      { label: '🌬️ B 九降風智慧', text: 'B 九降風智慧' },
      { label: '🦀 C 高美濕地', text: 'C 高美濕地' },
      { label: '⏩ 下一節', text: '下一節' },
      { label: '⚡ 全部照常', text: '全部照常' }
    ];
  } else {
    desc = contextPrefix +
      `建議教學方案：\n\n` +
      `[A] 標準教學進度循序推動\n` +
      `[B] 習作與課堂練習精練補救\n` +
      `[C] 生活化應用與小組互動發表\n\n` +
      `👉 請點選建議，或直接輸入自訂進度：`;
    options = {
      'A': '標準教學進度循序推動',
      'B': '習作與課堂練習精練補救',
      'C': '生活化應用與小組互動發表'
    };
    quickReplies = [
      { label: '📖 A 標準進度', text: 'A 標準進度' },
      { label: '✏️ B 精練補救', text: 'B 精練補救' },
      { label: '🌟 C 生活應用', text: 'C 生活應用' },
      { label: '⏩ 下一節', text: '下一節' },
      { label: '⚡ 全部照常', text: '全部照常' }
    ];
  }

  return {
    isHomeroom: true,
    periodName: periodName,
    subject: subject,
    title: title,
    fullText: `${title}\n━━━━━━━━━━━━━━\n${desc}`,
    options: options,
    quickReplies: quickReplies
  };
}


/**
 * 每日 20:00 晚間推播 / 下班復盤啟動：
 * 結合國定假日、週末與學校補休自動研判：
 * - 若當天是放假日（週末/國定假日/補休日）：主動提醒放假好好休息，並引導預先規劃下個正式上課日
 * - 若當天為正式上課日（或老師點選預先規劃）：自動計算下一個教學日（跳過假日與補休），啟動逐節確認
 */
function triggerEveningInteractiveReview(targetUserId, replyToken, isForceNext) {
  const teacherId = targetUserId || getTeacherUserId();
  if (!teacherId && !replyToken) {
    console.warn('尚未記錄導師 User ID 且無 replyToken，無法執行晚間復盤推播。請在 LINE 輸入「綁定推播」或在 GAS 執行 setupDailyTriggers。');
    return;
  }

  const today = new Date();
  const todayStr = Utilities.formatDate(today, 'GMT+8', 'yyyy-MM-dd');
  const todayInfo = getDateHolidayInfo(today);
  const nextSchoolDay = getNextSchoolDay(today);

  // 【核心校驗】：如果今天是假日（週末、國定假日、補休日），且不是老師主動要求預先規劃
  if (!todayInfo.isSchoolDay && !isForceNext) {
    const holidayMsg = `☕ 【今日為放假日（${todayInfo.reason}）】\n` +
      `━━━━━━━━━━━━━━\n` +
      `今日全校放假，無課堂教學，不需進行今日課堂復盤，請老師好好休息充電！🏖️\n\n` +
      `🎯 下一個正式教學上課日為：\n` +
      `👉 【${nextSchoolDay.dateStr} 週${nextSchoolDay.dayZh}】（${CONFIG.UNIFORMS[nextSchoolDay.dayZh] || '便服'}）\n` +
      `${nextSchoolDay.calendarEvents.length > 0 ? `🏫 行事：${nextSchoolDay.calendarEvents.join('、')}\n` : ''}\n` +
      `💡 您若想提前為下一個教學日預作準備，可點選下方按鈕開始預先規劃各節待辦！`;

    const holidayQuickReplies = [
      { label: '🎯 預先規劃下個上課日', text: '預先規劃下個上課日' },
      { label: '📊 個人儀表板', text: '個人儀表板' },
      { label: '💡 備課錦囊', text: '快速備課' }
    ];

    if (replyToken) {
      replyTextMessageWithQuickReply(replyToken, holidayMsg, holidayQuickReplies);
    } else if (teacherId) {
      pushMessageWithQuickReply(teacherId, holidayMsg, holidayQuickReplies);
    }
    return;
  }

  // 決定目標教學日（已精準結合國定假日與補休校驗，自動跳過放假）
  const targetDateStr = nextSchoolDay.dateStr;
  const targetDayZh = nextSchoolDay.dayZh;
  let targetSchedule = getScheduleByDay(targetDayZh);
  const targetCalendar = nextSchoolDay.calendarEvents;
  const targetUniform = CONFIG.UNIFORMS[targetDayZh] || '便服';

  // 梧棲中正國小週一、週三為半天課（中午 12:00 放學，僅有 1~4 節）
  if ((targetDayZh === '一' || targetDayZh === '三') && targetSchedule.length > 5) {
    targetSchedule = targetSchedule.filter(s => {
      const p = String(s.period);
      return !p.includes('五') && !p.includes('六') && !p.includes('七');
    });
  }

  const sessionData = {
    todayStr: todayStr,
    targetDateStr: targetDateStr,
    targetDayZh: targetDayZh,
    targetUniform: targetUniform,
    targetCalendar: targetCalendar,
    schedule: targetSchedule,
    currentIndex: 0,
    answers: []
  };

  if (teacherId) {
    saveSessionState(teacherId, 'EVENING_STEP_BY_STEP', sessionData);
  }

  // 起始引言（清楚標明已自動校驗國定假日與補休）
  const introMsg = `🌙 【${isForceNext ? '預先規劃下個教學日' : '下班復盤啟動'}・一節一節確認安排】\n` +
    `🎯 規劃目標：${targetDateStr} 週${targetDayZh}（${targetUniform}）\n` +
    `📌 提示：已自動結合國定假日與補休校驗，跳過非上課日。\n` +
    `共 ${targetSchedule.length} 節課，我們一節一節快速確認！\n` +
    `（提示：非國/數/社/綜合/電腦/梧風之科任課，將提供「導師空白時間待辦」；亦可隨時點「⚡全部照常」一鍵完成）\n\n`;

  sendReviewStepQuestion(teacherId, replyToken, sessionData, introMsg);
}

/**
 * 發送單一節次之復盤詢問卡片（傳入 sessionData.answers 達成連貫脈絡感知）
 */
function sendReviewStepQuestion(userId, replyToken, sessionData, prefixMsg) {
  const index = sessionData.currentIndex;
  const currentPeriod = sessionData.schedule[index];
  const card = getPeriodReviewCard(currentPeriod, index, sessionData.schedule.length, sessionData.targetDayZh, sessionData.targetDateStr, sessionData.answers || []);

  const fullText = (prefixMsg ? prefixMsg : '') + card.fullText;

  if (replyToken) {
    replyTextMessageWithQuickReply(replyToken, fullText, card.quickReplies);
  } else if (userId) {
    pushMessageWithQuickReply(userId, fullText, card.quickReplies);
  }
}

/**
 * 處理導師「一節一節來」的回覆
 * 支援：
 * 1. 跨節/多節覆蓋識別（如「早自習到第二節需要運動會預演」，自動覆蓋所跨節次並跳過詢問）
 * 2. 脈絡連貫生成（傳入已確認清單 answers，讓後續空堂待辦與教學具備因果承接邏輯）
 */
function handleStepByStepReviewReply(userId, text, replyToken) {
  const session = getSessionState(userId);
  if (!session || !session.data) {
    replyTextMessage(replyToken, '復盤狀態已過期，請點選「下班復盤」重新開始！');
    return;
  }

  const data = session.data;
  let index = data.currentIndex || 0;
  const schedule = data.schedule || [];
  const answers = data.answers || [];

  if (index >= schedule.length) {
    finishEveningStepReview(userId, data, replyToken);
    return;
  }

  const cleanText = text.trim();

  // 若導師選擇「全部照常」或「全選A」
  if (cleanText.includes('全部照常') || cleanText === '全選A' || cleanText === '全部A') {
    for (let i = index; i < schedule.length; i++) {
      const p = schedule[i];
      const card = getPeriodReviewCard(p, i, schedule.length, data.targetDayZh, data.targetDateStr, answers);
      answers.push({
        period: p.period,
        subject: p.subject,
        isHomeroom: card.isHomeroom,
        choice: card.options['A'] || '照常規推進'
      });
    }
    data.currentIndex = schedule.length;
    data.answers = answers;
    finishEveningStepReview(userId, data, replyToken);
    return;
  }

  // 跨節識別：若導師輸入跨節安排（如「早自習到第二節需要運動會預演」或「上午連兩節作文」）
  const spanResult = analyzePeriodSpan(cleanText, index, schedule);
  if (spanResult && spanResult.isSpan && spanResult.coveredIndices && spanResult.coveredIndices.length > 0) {
    spanResult.coveredIndices.forEach((pIdx) => {
      const p = schedule[pIdx];
      const isHm = isHomeroomSubject(p.subject);
      answers.push({
        period: p.period,
        subject: p.subject,
        isHomeroom: isHm,
        choice: spanResult.activityName
      });
    });

    const maxCoveredIdx = Math.max(...spanResult.coveredIndices);
    index = maxCoveredIdx + 1;
    data.currentIndex = index;
    data.answers = answers;

    if (index < schedule.length) {
      saveSessionState(userId, 'EVENING_STEP_BY_STEP', data);
      const confirmPrefix = `✅ 已為您將【${spanResult.coveredPeriodsText}】連貫排定為：\n👉 ${spanResult.activityName}\n━━━━━━━━━━━━━━\n\n`;
      sendReviewStepQuestion(userId, replyToken, data, confirmPrefix);
    } else {
      finishEveningStepReview(userId, data, replyToken);
    }
    return;
  }

  // 處理單節次之選擇或自訂
  const currentP = schedule[index];
  const card = getPeriodReviewCard(currentP, index, schedule.length, data.targetDayZh, data.targetDateStr, answers);
  let chosenText = '';

  if (cleanText.startsWith('A') || cleanText.includes('[A') || cleanText.includes('A ')) {
    chosenText = card.options['A'] || cleanText;
  } else if (cleanText.startsWith('B') || cleanText.includes('[B') || cleanText.includes('B ')) {
    chosenText = card.options['B'] || cleanText;
  } else if (cleanText.startsWith('C') || cleanText.includes('[C') || cleanText.includes('C ')) {
    chosenText = card.options['C'] || cleanText;
  } else if (cleanText.includes('下一節') || cleanText.includes('跳過')) {
    chosenText = card.options['A'] || '照常規推進';
  } else {
    // 導師單節自訂具體文字（例如：「這節改看防災宣導影片」）
    chosenText = cleanText;
  }

  answers.push({
    period: currentP.period,
    subject: currentP.subject,
    isHomeroom: card.isHomeroom,
    choice: chosenText
  });

  index++;
  data.currentIndex = index;
  data.answers = answers;

  if (index < schedule.length) {
    saveSessionState(userId, 'EVENING_STEP_BY_STEP', data);
    const confirmPrefix = `✅ ${currentP.period}（${currentP.subject}）已記錄：\n👉 ${chosenText}\n━━━━━━━━━━━━━━\n\n`;
    sendReviewStepQuestion(userId, replyToken, data, confirmPrefix);
  } else {
    finishEveningStepReview(userId, data, replyToken);
  }
}

/**
 * 復盤全部節次確認完成：組合清單、存入試算表與儀表板、回傳完成訊息
 */
function finishEveningStepReview(userId, data, replyToken) {
  const targetDateStr = data.targetDateStr;
  const targetDayZh = data.targetDayZh;
  const targetUniform = data.targetUniform;
  const targetCalendar = data.targetCalendar || [];
  const answers = data.answers || [];

  let planLines = [];
  answers.forEach((ans) => {
    const icon = ans.isHomeroom ? (ans.period.includes('早自修') ? '☀️' : (ans.subject.includes('社') ? '📗' : (ans.subject.includes('國') || ans.subject.includes('數') ? '📘' : '💻'))) : '☕';
    const tag = ans.isHomeroom ? (ans.period.includes('早自修') ? '' : ' [導師課]') : ' [科任課·導師空白時間]';
    planLines.push(`${icon} ${ans.period} ${ans.subject}${tag}：\n   ➔ ${ans.choice}`);
  });

  const isHalfDay = (targetDayZh === '一' || targetDayZh === '三');
  const dismissTime = isHalfDay ? '12:00 半天放學（路隊引導與安全離校）' : '15:50 全天放學（打掃、聯絡簿確認、路隊引導）';
  planLines.push(`🎒 放學時間：${dismissTime}`);

  const finalPlanText = planLines.join('\n\n');

  // 儲存至試算表「每日待辦」分頁
  saveTomorrowPlanToSheet(targetDateStr, targetDayZh, finalPlanText);
  clearSessionState(userId);

  const wrapUpMsg = `🎉 【下一個教學日（${targetDateStr} 週${targetDayZh}）教學與待辦全數排定完成！】\n` +
    `━━━━━━━━━━━━━━\n` +
    `👗 學生服裝：${targetUniform}\n` +
    `🏫 學校行事：${targetCalendar.length > 0 ? targetCalendar.join('、') : '常規教學日'}\n\n` +
    `📋 【各節次已確認之教學與待辦清單】：\n` +
    `${finalPlanText}\n` +
    `━━━━━━━━━━━━━━\n` +
    `💡 此規劃已同步至試算表與個人儀表板。明晨 06:30 會主動為您發送晨間安排確認！祝老師下班愉快順心！`;

  const quickReplies = [
    { label: '📊 個人儀表板', text: '個人儀表板' },
    { label: '⚡ 臨時改變進度', text: '臨時改變進度' },
    { label: '🔄 重新設計進度', text: '重新設計進度' }
  ];

  if (replyToken) {
    replyTextMessageWithQuickReply(replyToken, wrapUpMsg, quickReplies);
  } else if (userId) {
    pushMessageWithQuickReply(userId, wrapUpMsg, quickReplies);
  }
}

/**
 * 舊版相容：處理整包確認模式
 */
function handleEveningConfirmation(userId, text, replyToken) {
  clearSessionState(userId);
  replyTextMessage(replyToken, '收到！已為您更新。隨時點選「下班復盤」即可啟動新版逐節復盤！');
}

// ======================== 【定時排程推播與觸發條件管理】 ========================

/**
 * 【一鍵全自動推播健檢與修復】（強烈建議在 GAS 編輯器上方選擇此函式並點擊「執行」）
 * 1. 檢測 GAS 專案時區是否為台灣時間 (Asia/Taipei)
 * 2. 檢測導師 LINE User ID 是否成功鎖定
 * 3. 檢測並自動建立 06:30 與 20:00 的定時觸發器 (Triggers)
 * 4. 立即發送一則 LINE 測試推播驗證 Messaging API 通道
 */
function diagnoseAndFixPushSystem() {
  console.log('🔍 開始進行推播系統全面健檢...');
  const report = [];

  // 1. 檢查時區
  const timeZone = Session.getScriptTimeZone();
  console.log('📌 當前 GAS 專案時區: ' + timeZone);
  if (timeZone !== 'Asia/Taipei' && timeZone !== 'GMT+8') {
    report.push(`⚠️ 專案時區警告：當前時區為 [${timeZone}]，若非 Asia/Taipei，定時推播時間將產生嚴重誤差！請在專案設定中將時區設定為 (GMT+08:00) 台北。`);
  } else {
    report.push('✅ 專案時區正確：' + timeZone);
  }

  // 2. 檢查導師 ID
  const teacherId = getTeacherUserId();
  if (teacherId) {
    report.push(`✅ 導師 LINE ID 已綁定：${teacherId}`);
  } else {
    report.push('❌ 尚未找到導師 LINE ID！請先在 LINE 官方帳號對話框中發送任意訊息（例如「綁定推播」或「開工」），系統即可自動捕捉鎖定。');
  }

  // 3. 檢查現有 Triggers 並自動修復重建
  const triggers = ScriptApp.getProjectTriggers();
  console.log(`📌 目前專案共有 ${triggers.length} 個生效觸發條件`);
  let hasMorning = false;
  let hasEvening = false;
  for (let i = 0; i < triggers.length; i++) {
    const fn = triggers[i].getHandlerFunction();
    console.log(`- 觸發條件 [${i + 1}]: ${fn} (${triggers[i].getEventType()})`);
    if (fn === 'sendMorningBriefing' || fn === 'sendMorningInteractiveBriefing') hasMorning = true;
    if (fn === 'triggerEveningRDQ' || fn === 'triggerEveningInteractiveReview') hasEvening = true;
  }

  if (!hasMorning || !hasEvening) {
    console.log('⚡ 偵測到定時觸發條件缺失，立即自動為您重新建置...');
    setupDailyTriggers();
    report.push('✅ 已自動重新建立 06:00-07:00 晨間安排與 20:00-21:00 晚間復盤觸發器！');
  } else {
    report.push('✅ 每日晨間與晚間定時觸發條件均已在 GAS 伺服器排程中正常運行！');
  }

  // 4. 即時發送測試訊息
  if (teacherId) {
    try {
      pushMessage(teacherId, `🧪 【推播系統連線診斷成功】\n━━━━━━━━━━━━━━\n現在時間：${Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm:ss')}\n專案時區：${timeZone}\n觸發條件：晨間(06:00-07:00)、晚間(20:00-21:00) 已全部生效！\n\n若您在手機上看見此訊息，代表定時推播通道完全暢通！`);
      report.push('✅ LINE 測試推播已成功送達導師手機！');
    } catch (e) {
      report.push('❌ 發送 LINE 測試訊息失敗：' + e.toString());
    }
  }

  console.log('================ 健檢診斷總結報告 ================');
  console.log(report.join('\n'));
  return report.join('\n');
}

/**
 * 06:30 晨間安排定時進入點（相容舊名與 Trigger 入口）
 */
function sendMorningBriefing() {
  try {
    sendMorningInteractiveBriefing();
  } catch (err) {
    console.error('sendMorningBriefing 執行異常: ' + (err.stack || err.toString()));
  }
}

/**
 * 20:00 晚間復盤定時進入點（相容舊名與 Trigger 入口）
 */
function triggerEveningRDQ() {
  try {
    triggerEveningInteractiveReview();
  } catch (err) {
    console.error('triggerEveningRDQ 執行異常: ' + (err.stack || err.toString()));
  }
}

/**
 * 一鍵設定/重設所有每日自動定時推播觸發條件
 * 可在 GAS 編輯器直接選擇本函式點「執行」，或在 LINE 輸入「設定推播」
 */
function setupDailyTriggers() {
  // 1. 清除舊有或重複的推播觸發條件
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    const fn = triggers[i].getHandlerFunction();
    if (fn === 'sendMorningBriefing' || fn === 'sendMorningInteractiveBriefing' || 
        fn === 'triggerEveningRDQ' || fn === 'triggerEveningInteractiveReview') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // 2. 建立晨間 06:00 - 07:00 觸發器（日計時器）
  ScriptApp.newTrigger('sendMorningBriefing')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();

  // 3. 建立晚間 20:00 - 21:00 觸發器（日計時器）
  ScriptApp.newTrigger('triggerEveningRDQ')
    .timeBased()
    .everyDays(1)
    .atHour(20)
    .create();

  console.log('✅ 每日定時觸發條件已成功建立（06:00-07:00 晨間安排、20:00-21:00 晚間復盤）！');

  const teacherId = getTeacherUserId();
  if (teacherId) {
    pushMessage(teacherId, '🔔 【定時推播觸發條件已成功重新設定與校準】\n━━━━━━━━━━━━━━\n系統已正式啟動每日自動排程：\n☀️ 06:30 晨間課堂建議與臨時交辦確認\n🌙 20:00 晚間逐節復盤與明日待辦規劃\n\n📌 綁定導師：已成功鎖定您的 LINE 帳號！');
    return `✅ 觸發條件已成功建立，並已向導師 (${teacherId}) 發送確認通知！`;
  } else {
    return '✅ 觸發條件已成功建立！請在 LINE 官方帳號輸入「綁定推播」以完成導師帳號鎖定。';
  }
}

/**
 * 測試定時推播連線能力（可在 GAS 編輯器直接點選執行測試）
 */
function testScheduledPush() {
  const teacherId = getTeacherUserId();
  if (!teacherId) {
    throw new Error('❌ 未找到導師 User ID！請先在 LINE 官方帳號傳送「綁定推播」，系統即可自動捕捉並鎖定您的 ID。');
  }

  pushMessage(teacherId, `🧪 【定時推播連線測試】\n━━━━━━━━━━━━━━\n現在時間：${Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm:ss')}\n導師 ID：${teacherId}\n\nLINE Messaging API 連線完全正常！系統將於每日 06:30 與 20:00 自動向您發送詢問卡片。`);
  return '測試推播已發送！請檢查 LINE 官方帳號。';
}

/**
 * 處理 LINE 文字指令「綁定推播 / 設定推播 / 測試推播」
 */
function handleTriggerSetupCommand(userId, replyToken) {
  if (userId && String(userId).startsWith('U')) {
    SCRIPT_PROPERTIES.setProperty('TEACHER_USER_ID', userId);
    CONFIG.TEACHER_USER_ID = userId;
  }

  let triggerStatus = '';
  try {
    setupDailyTriggers();
    triggerStatus = '✅ 每日定時觸發條件已由程式自動建置完成！';
  } catch (err) {
    triggerStatus = '⚠️ 觸發條件建立提示：' + err.message + '\n（亦可在 Apps Script 編輯器上方選擇 setupDailyTriggers 點擊執行一鍵啟動）';
  }

  const replyMsg = `🔔 【導師推播設定與帳號綁定成功】\n` +
    `━━━━━━━━━━━━━━\n` +
    `▫️ 導師 LINE ID：${userId || '已成功鎖定'}\n` +
    `▫️ 排程狀態：${triggerStatus}\n\n` +
    `⏰ 【每日定時推播時段】：\n` +
    `☀️ 06:30 晨間課堂建議與臨時交辦確認\n` +
    `🌙 20:00 晚間逐節復盤與明日待辦規劃\n` +
    `━━━━━━━━━━━━━━\n` +
    `💡 系統將於指定時段主動向您發送詢問卡片！`;

  replyTextMessage(replyToken, replyMsg);
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
    const recents = data.filter(r => r && r[0]).slice(-3).reverse();
    recentExpenses = recents.map(r => `▫️ ${safeFormatDate(r[0], 'MM/dd') || String(r[0])} ${r[1]}：$${Number(r[4] || 0).toLocaleString()} (${r[2]})`);
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

function replyTodaySchedule(replyToken, userId) {
  const teacherId = userId || getTeacherUserId();
  const today = new Date();
  const dayZh = getDayOfWeekZh(today.getDay());
  const todayStr = Utilities.formatDate(today, 'GMT+8', 'yyyy-MM-dd');
  const todayInfo = getDateHolidayInfo(today);
  const nextSchoolDay = getNextSchoolDay(today);

  // 【國定假日/補休/週末放假防護】：若今日為非上課日
  if (!todayInfo.isSchoolDay) {
    const holidayMsg = `📅 【今日行事提醒（${todayStr} 週${dayZh}）】\n` +
      `━━━━━━━━━━━━━━\n` +
      `🏖️ 今日狀態：【放假日 / 無課堂】（${todayInfo.reason}）\n` +
      `💡 今日全校無須到校上課，祝老師假期充實愉快！\n\n` +
      `🎯 下一個正式上課日：\n` +
      `👉 【${nextSchoolDay.dateStr} 週${nextSchoolDay.dayZh}】（${CONFIG.UNIFORMS[nextSchoolDay.dayZh] || '便服'}）\n` +
      `${nextSchoolDay.calendarEvents.length > 0 ? `🏫 行事：${nextSchoolDay.calendarEvents.join('、')}\n` : ''}\n` +
      `您可隨時點選下方按鈕，提前為下個教學日預作安排！`;

    const quickReplies = [
      { label: '🎯 預先規劃下個上課日', text: '預先規劃下個上課日' },
      { label: '📊 個人儀表板', text: '個人儀表板' },
      { label: '💡 備課錦囊', text: '快速備課' }
    ];
    replyTextMessageWithQuickReply(replyToken, holidayMsg, quickReplies);
    return;
  }

  const schedule = getScheduleByDay(dayZh);
  const calendarEvents = getCalendarEvents(todayStr);
  const plan = getSavedPlan(todayStr);
  const uniformNote = CONFIG.UNIFORMS[dayZh] || '便服';

  // 1. 若今日已有確認鎖定之各節客製待辦（字數大於 50 字視為完整規劃）
  if (plan && plan.length > 50 && !plan.includes('尚未產生')) {
    const msg = `📅 【今日課程安排與各節建議（${CONFIG.CLASS_NAME}·週${dayZh}）】\n` +
      `━━━━━━━━━━━━━━\n` +
      `👗 學生服裝：${uniformNote}\n` +
      `🏫 學校行事：${calendarEvents.length > 0 ? calendarEvents.join('、') : '今日常規教學，無重大集會'}\n\n` +
      `📋 【已確認鎖定之各節次待辦】：\n${plan}\n\n` +
      `💡 導師可隨時點選下方按鈕微調進度！`;

    const quickReplies = [
      { label: '⚡ 臨時改變進度', text: '臨時改變進度' },
      { label: '🔄 重新設計進度', text: '重新設計進度' },
      { label: '💡 備課錦囊', text: '快速備課' },
      { label: '📊 個人儀表板', text: '個人儀表板' }
    ];
    replyTextMessageWithQuickReply(replyToken, msg, quickReplies);
    return;
  }

  // 2. 若今日尚未產出各節三選一建議，動態生成各節次三選一提案（嚴格遵守：非國數社綜合電腦梧風者，轉為導師空白時間待辦）
  let proposalText = '';
  try {
    const prompt = `你是一名專屬支援【臺中市梧棲區中正國民小學 四年丙班 (304班)】的專業教務智慧助教。
嚴格遵守【G4 Curriculum Review 全域三階漏斗審查】：
- 教科書版本：南一數學 4上、翰林國語 4上、康軒社會 4上、校本彈性梧風啟航
- 關鍵進度：南一數期中已全教完進入複習；翰林國未教第6課第四段與統整活動一二；康軒社未教第二單元全單元；作文缺一篇。
- 重要規則：若為國、數、社、綜合、電腦、梧風起航或早自修，給予教學三選一建議；其餘科目（如自然、體育、音樂、美勞、英語等科任課）一律轉為【導師空白時間・空堂備課待辦】（如批閱作業、班務親師、備課印卷），絕不給該科授課建議！

${getCurriculumPromptContext()}

今天是 ${todayStr} 星期${dayZh}。
服裝規定：${uniformNote}
今日課表節次：
${JSON.stringify(schedule, null, 2)}
今日學校重大行事：${calendarEvents.length > 0 ? calendarEvents.join('、') : '常規教學日'}

請以極具結構感、清晰好讀的繁體中文條列呈現：
☀️ 今日總覽：服裝提醒 + 放學時間 + 學校行事
⏰ 各節次提案（導師課提供A/B/C教學建議；科任課提供導師空白時間A/B/C待辦建議）：
...依今日課表所有節次依序列出...
▫️ 放學注意事項

文末引導導師：「您可回傳『全選A』、『全選B』，或輸入微調。亦可點選下方按鈕調整！」`;

    proposalText = callGeminiText(prompt);
  } catch (err) {
    console.warn('Gemini 產出今日建議失敗，使用結構化備援卡片: ' + err.toString());
    let fallbackLines = [
      `☀️ 【今日總覽（${CONFIG.CLASS_NAME}·週${dayZh}）】`,
      `👗 學生服裝：${uniformNote}`,
      `🏫 學校行事：${calendarEvents.length > 0 ? calendarEvents.join('、') : '今日常規教學，無重大集會'}`,
      `━━━━━━━━━━━━━━`,
      `⏰ 【今日各節次建議方案】：`
    ];
    for (let i = 0; i < schedule.length; i++) {
      const p = schedule[i];
      const card = getPeriodReviewCard(p, i, schedule.length, dayZh, todayStr);
      const icon = card.isHomeroom ? (card.periodName.includes('早自修') ? '☀️' : '📘') : '☕';
      const label = card.isHomeroom ? '' : '（科任課・導師空白時間）';
      fallbackLines.push(`${icon} ${card.periodName} - ${card.subject}${label}：\n   [A] ${card.options['A']}\n   [B] ${card.options['B']}\n   [C] ${card.options['C']}`);
    }
    fallbackLines.push(`━━━━━━━━━━━━━━\n💡 導師可回傳「全選A」、「全選B」，或點選下方按鈕！`);
    proposalText = fallbackLines.join('\n\n');
  }

  if (teacherId) {
    saveSessionState(teacherId, 'MORNING_PENDING', {
      date: todayStr,
      dayZh: dayZh,
      proposal: proposalText
    });
  }

  const quickReplies = [
    { label: '✅ 全選進度(全A)', text: '全選A' },
    { label: '📘 全選補救(全B)', text: '全選B' },
    { label: '⚡ 臨時改變進度', text: '臨時改變進度' },
    { label: '🔄 重新設計進度', text: '重新設計進度' }
  ];

  replyTextMessageWithQuickReply(replyToken, proposalText, quickReplies);
}

/**
 * 國小導師專屬「實戰即用型快速備課神器」
 * - 自動辨識時間：若已過 15:30 放學或週末假日，自動鎖定「次一正式教學日（如明天）」的課表科目
 * - 支援多維度實用落地：
 *   1. 總覽模式：提供明日（或今日）課表、導師科目進度與 5 大快捷科目按鈕
 *   2. 數學專用：南一數 4上 螺旋複習、除法/三角形試商口訣、隨堂三題黑板題與解答
 *   3. 國語專用：翰林國 4上 第6課第四段、讀信格式、生字難字、閱讀三層次提問
 *   4. 作文專用：期中前第4篇作文「我最敬佩的人」四段結構鷹架、謄稿互評檢核表
 *   5. 社會專用：康軒社 4上 第二單元傳統住屋與生活器物就地取材圖表
 *   6. 範圍圖專用：10/30 (下週五) 期中定期評量範圍推播家長圖文草稿
 */
function replyPreparationTips(replyToken, queryText) {
  const query = String(queryText || '').trim();
  const now = new Date();
  const currentHour = now.getHours();

  // 若目前時間在 15:30 之後或今天不是正式上課日，自動針對「下一個教學日」備課
  const todayInfo = getDateHolidayInfo(now);
  let targetDateObj = now;
  let isNextDay = false;

  if (currentHour >= 15 || !todayInfo.isSchoolDay) {
    const nextSchool = getNextSchoolDay(now);
    targetDateObj = nextSchool.dateObj;
    isNextDay = true;
  }

  const targetDateStr = safeFormatDate(targetDateObj, 'yyyy-MM-dd');
  const targetDayZh = getDayOfWeekZh(targetDateObj.getDay());
  const schedule = getScheduleByDay(targetDayZh);
  const uniformNote = CONFIG.UNIFORMS[targetDayZh] || '便服';
  const calendarEvents = getCalendarEvents(targetDateStr);

  const homeroomPeriods = schedule.filter(s => isHomeroomSubject(s.subject));
  const homeroomSubjectNames = Array.from(new Set(homeroomPeriods.map(s => s.subject))).join('、');

  // Quick Replies 快捷按鈕列
  const prepQuickReplies = [
    { label: '📐 數學即用教案', text: '數學備課' },
    { label: '📘 國語即用教案', text: '國語備課' },
    { label: '✍️ 作文謄稿互評', text: '作文備課' },
    { label: '📗 社會即用教案', text: '社會備課' },
    { label: '📢 考前範圍海報', text: '期中考前範圍圖' }
  ];

  // 1. 若查詢包含「數」
  if (query.includes('數')) {
    const mathContent = `📐 【南一數學 4上・期中考螺旋複習即用備課卡】\n` +
      `━━━━━━━━━━━━━━\n` +
      `🎯 教學範圍：單元一～五（億以內數、乘法、角度、除法、三角形）\n` +
      `📌 課堂核心：除法試商補零錯題診斷、三角形等腰性質精熟\n\n` +
      `📝 【關鍵板書與口訣】：\n` +
      `1. 除法試商：除數是兩位，先看被除數前兩位；前兩位不夠除，看前三位。\n` +
      `2. 補零防漏口訣：「除到哪一位，商寫在哪一位；不夠除，商記 0 佔位！」（例：624÷20＝31...4，不可寫成 3...4）\n` +
      `3. 三角形判定：「兩邊等長是等腰，兩底角必相等；三邊等長是正三角，三角皆 60 度。」\n\n` +
      `✏️ 【課堂黑板隨堂 3 題（可直接抄給學生做）】：\n` +
      `Q1: 480 ÷ 24 ＝ [ 20 ] （檢核商的個位是否漏補 0）\n` +
      `Q2: 756 ÷ 36 ＝ [ 21 ] （二位數除法試商調商演練）\n` +
      `Q3: [素養題] 梧棲漁港一箱白鯧魚賣 850 元，平分給 25 位遊客，每人應付多少元？\n` +
      `    ➔ 算式：850 ÷ 25 ＝ 34 (元)\n\n` +
      `💡 易錯迷思：除法餘數大於或等於除數、量角器中心點與內外圈刻度看錯。課堂可請學生交換檢視！`;

    replyTextMessageWithQuickReply(replyToken, mathContent, prepQuickReplies);
    return;
  }

  // 2. 若查詢包含「國」
  if (query.includes('國')) {
    const chineseContent = `📘 【翰林國語 4上・第6課第四段與統整活動一備課卡】\n` +
      `━━━━━━━━━━━━━━\n` +
      `🎯 教學範圍：第6課《又遠又近的月亮》第四段科技省思、統整活動一\n` +
      `📌 課堂核心：登月科技省思、句型「就算…也…」、讀信書信格式\n\n` +
      `📝 【課堂 3 層次提問設計】：\n` +
      `1. 訊息提取：從古人看月亮到現代人類登月，人類科技有了什麼具體突破？（阿波羅計畫、阿提米絲月球探測）\n` +
      `2. 推論理解：為什麼課文標題叫做「又遠又近的月亮」？（空間距離很遠，但科技與人類的情感讓月亮很近）\n` +
      `3. 句型造句：就算……也……\n` +
      `   ➔ 例句：「就算冬季九降風再強勁，梧棲的船長也勇敢掌舵出航。」\n\n` +
      `✍️ 【生字難字提醒】：\n` +
      `・「載」：車部，半包圍結構，右上方戈部筆畫為先橫、斜勾、後撇點。\n` +
      `・「宇」與「宙」：寶蓋頭，上下結構，引導宇宙時空概念。\n\n` +
      `📋 【統整活動一重點】：信件五大格式（稱謂、問候語、正文、祝福語、署名與日期）。`;

    replyTextMessageWithQuickReply(replyToken, chineseContent, prepQuickReplies);
    return;
  }

  // 3. 若查詢包含「作」
  if (query.includes('作')) {
    const writingContent = `✍️ 【期中前第 4 篇作文：《我最敬佩的人》謄稿互評指導卡】\n` +
      `━━━━━━━━━━━━━━\n` +
      `🎯 目標：完成期中評量前第4篇作文，指導首稿修改、謄真與同儕互評。\n\n` +
      `🧱 【四段鷹架結構引導】：\n` +
      `・第一段（引言）：介紹他是誰？他的外貌、身份或你們認識的機緣。（點出敬佩對象：如海線消防員、辛勞的母親、老街傳承師傅）\n` +
      `・第二段（事例一）：描寫一件他最令你印象深刻的事蹟（動態描寫、神態語言）。\n` +
      `・第三段（事例二/細節）：在面對困難或辛勞時，他展現出的堅持、善良或敬業精神。\n` +
      `・第四段（結尾）：他對我產生的影響與啟發，我希望能向他學習什麼特質。\n\n` +
      `🔍 【同儕互評 4 大檢核點】：\n` +
      `[ ] 標點符號：每格一字，上下引號、逗號句號位置正確。\n` +
      `[ ] 錯別字：挑出至少 2 個易錯字並請作者訂正。\n` +
      `[ ] 修辭佳句：圈出一句運用譬喻、感官摹寫或排比的好句子。\n` +
      `[ ] 具體事例：是否寫出完整的一件事，而不是空泛讚美？`;

    replyTextMessageWithQuickReply(replyToken, writingContent, prepQuickReplies);
    return;
  }

  // 4. 若查詢包含「社」
  if (query.includes('社')) {
    const socialContent = `📗 【康軒社會 4上・第二單元《家鄉的傳統住屋與器物》備課卡】\n` +
      `━━━━━━━━━━━━━━\n` +
      `🎯 教學範圍：2-1 傳統住屋與生活環境（三合院、土埆厝、石板屋、高腳屋）\n` +
      `📌 課堂核心：就地取材的生活智慧、住屋結構與氣候環境的互動\n\n` +
      `📝 【核心觀念比較表（可直接畫在黑板）】：\n` +
      `・三合院：閩南傳統建築，正身（長輩居中神明廳）＋左右護龍（子孫居住，重視倫理與宗族團結）。\n` +
      `・土埆厝：早期平原農業社會，用稻草、泥土、稻穀混合曬乾製成土埆磚（冬暖夏涼、經濟實用）。\n` +
      `・石板屋：原住民排灣族、魯凱族，就地取材頁岩或板岩（耐震、防風、適應山區氣候）。\n` +
      `・高腳屋：適應潮濕多雨、防蛇蟲侵害與通風散熱。\n\n` +
      `🌊 【海線在地情境連結】：\n` +
      `結合梧棲老街傳統街屋建築特色（紅磚街屋、防九降風之天井格局），讓孩子感受傳統住屋之美！`;

    replyTextMessageWithQuickReply(replyToken, socialContent, prepQuickReplies);
    return;
  }

  // 5. 若查詢包含「範圍」或「海報」
  if (query.includes('範圍') || query.includes('海報')) {
    const noticeDraft = `📢 【304班 期中定期評量範圍與重要叮嚀】（家長通知草稿）\n` +
      `━━━━━━━━━━━━━━\n` +
      `親愛的 304 班家長您好：\n` +
      `本學期第一次定期評量即將於下週 11/05(四) ~ 11/06(五) 舉行，請家長協助孩子按部就班複習，保持充沛睡眠！\n\n` +
      `📅 【評量日期與考科範圍】：\n` +
      `📘 11/05 (四)：\n` +
      `  - 國語科：翰林版 第 1～6 課、統整活動（一）、統整活動（二）\n` +
      `  - 自然科：第一單元～第二單元（科任教師命題）\n` +
      `📘 11/06 (五)：\n` +
      `  - 數學科：南一版 單元一至五（一億以內的數、乘法、角度、除法、三角形）\n` +
      `  - 社會科：康軒版 第一單元、第二單元\n` +
      `  - 英語科：Unit 1 ~ Review 1（科任教師命題）\n\n` +
      `💡 【導師叮嚀】：\n` +
      `1. 數學重視除法計算的驗算與審題，三角形請攜帶量角器與直尺。\n` +
      `2. 國語請加強生字生詞、成語運用與課文深究理解。\n` +
      `如有任何學習問題，歡迎隨時與老師聯繫！`;

    replyTextMessageWithQuickReply(replyToken, noticeDraft, prepQuickReplies);
    return;
  }

  // 預設總覽模式（智慧鎖定教學日）
  const timeTargetDesc = isNextDay ? `明天 【${targetDateStr} 週${targetDayZh}】` : `今日 【${targetDateStr} 週${targetDayZh}】`;
  const overviewMsg = `💡 【四年丙班 (304) 實戰即用型快速備課錦囊】\n` +
    `━━━━━━━━━━━━━━\n` +
    `🎯 備課鎖定目標：${timeTargetDesc}（${uniformNote}）\n` +
    `${calendarEvents.length > 0 ? `🏫 學校行事：${calendarEvents.join('、')}\n` : ''}` +
    `📚 本日導師授課科目：【${homeroomSubjectNames || '數學、國語、閱讀作文'}】\n\n` +
    `⚡ 【明日教學衝刺 3 大關鍵任務】：\n` +
    `1. 📐 數學（南一）：期中前五單元總複習，精熟除法三位數除以二位數試商補零錯題。\n` +
    `2. 📘 國語（翰林）：攻堅第6課第四段登月科技省思與統整活動一讀信格式。\n` +
    `3. ✍️ 作文（綜合/閱讀）：落實第4篇作文「我最敬佩的人」謄稿互評，補足期中作文缺額。\n` +
    `4. 📢 教務里程碑：下週定期評量在即，可發送期中考範圍海報安撫家長焦慮。\n\n` +
    `👉 請點選下方按鈕，立即獲取該科「黑板板書、迷思口訣、隨堂三題」即用教案卡：`;

  replyTextMessageWithQuickReply(replyToken, overviewMsg, prepQuickReplies);
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

// ======================== 【臺灣國定假日、補休與行事曆自動判定模組】 ========================

/**
 * 臺灣官方國定假日、連假與補假對照表（2026-2027 學年度）
 */
const TAIWAN_HOLIDAYS_MAP = {
  // 2026 年國定假日、連假與補假
  '2026-01-01': '元旦開國紀念日',
  '2026-02-14': '春節連假放假',
  '2026-02-15': '春節連假（小年夜）',
  '2026-02-16': '春節連假（除夕）',
  '2026-02-17': '春節連假（春節初一）',
  '2026-02-18': '春節連假（春節初二）',
  '2026-02-19': '春節連假（春節初三）',
  '2026-02-20': '春節連假（春節補假）',
  '2026-02-21': '春節連假',
  '2026-02-22': '春節連假',
  '2026-02-27': '228和平紀念日（補假一日）',
  '2026-02-28': '228和平紀念日',
  '2026-04-03': '兒童節（補假一日）',
  '2026-04-04': '兒童節',
  '2026-04-05': '清明節',
  '2026-04-06': '清明節（補假一日）',
  '2026-06-19': '端午節（放假一日）',
  '2026-09-25': '中秋節（放假一日）',
  '2026-10-09': '國慶日（補假一日）',
  '2026-10-10': '國慶日',
  '2027-01-01': '元旦開國紀念日（放假一日）'
};

const TAIWAN_MAKEUP_SCHOOL_DAYS = {
  // 若有行政院公告之彈性放假週六補課日，可在此登記
};

/**
 * 判斷指定日期是否為放假日（週末、國定假日、補休、校慶補假）或上課日
 */
function getDateHolidayInfo(dateObj) {
  const dateStr = Utilities.formatDate(dateObj, 'GMT+8', 'yyyy-MM-dd');
  const dayOfWeek = dateObj.getDay(); // 0: 週日, 6: 週六

  // 1. 優先檢查試算表「學校行事曆」的動態標記
  const calendarEvents = getCalendarEvents(dateStr);
  if (calendarEvents && calendarEvents.length > 0) {
    for (let i = 0; i < calendarEvents.length; i++) {
      const ev = String(calendarEvents[i]);
      // 若標記為補課、補行上課
      if (ev.includes('補課') || ev.includes('補行上課') || ev.includes('補行上班') || ev.includes('補班')) {
        return {
          isHoliday: false,
          isSchoolDay: true,
          reason: `補行上課日（${ev}）`,
          isMakeup: true,
          events: calendarEvents
        };
      }
      // 若標記為放假、補休、校慶補休、連假、停課
      if (ev.includes('補休') || ev.includes('補假') || ev.includes('放假') || ev.includes('連假') || 
          ev.includes('停課') || ev.includes('休假') || ev.includes('校慶補休') || ev.includes('運動會補休')) {
        return {
          isHoliday: true,
          isSchoolDay: false,
          reason: `學校行事放假/補休（${ev}）`,
          isMakeup: false,
          events: calendarEvents
        };
      }
    }
  }

  // 2. 檢查內建補課日
  if (TAIWAN_MAKEUP_SCHOOL_DAYS[dateStr]) {
    return {
      isHoliday: false,
      isSchoolDay: true,
      reason: `全校調整補課日（${TAIWAN_MAKEUP_SCHOOL_DAYS[dateStr]}）`,
      isMakeup: true,
      events: calendarEvents
    };
  }

  // 3. 檢查國定假日與補假對照表
  if (TAIWAN_HOLIDAYS_MAP[dateStr]) {
    return {
      isHoliday: true,
      isSchoolDay: false,
      reason: `國定假日/補假（${TAIWAN_HOLIDAYS_MAP[dateStr]}）`,
      isMakeup: false,
      events: calendarEvents
    };
  }

  // 4. 常規週末檢查 (週六、週日)
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return {
      isHoliday: true,
      isSchoolDay: false,
      reason: dayOfWeek === 0 ? '週日常規放假' : '週六常規放假',
      isMakeup: false,
      events: calendarEvents
    };
  }

  // 5. 常規上課日 (週一 ~ 週五)
  return {
    isHoliday: false,
    isSchoolDay: true,
    reason: '常規教學上課日',
    isMakeup: false,
    events: calendarEvents
  };
}

/**
 * 自動搜尋計算「下一個正式教學上課日」
 * 自動跳過週末、國定假日、補休日、校慶補假，直到找到第一個真正的上課日！
 */
function getNextSchoolDay(fromDateObj) {
  let curr = new Date(fromDateObj.getTime());
  for (let i = 1; i <= 30; i++) {
    curr.setDate(curr.getDate() + 1);
    const info = getDateHolidayInfo(curr);
    if (info.isSchoolDay) {
      const dateStr = Utilities.formatDate(curr, 'GMT+8', 'yyyy-MM-dd');
      const dayZh = getDayOfWeekZh(curr.getDay());
      return {
        date: curr,
        dateStr: dateStr,
        dayZh: dayZh,
        holidayInfo: info,
        calendarEvents: getCalendarEvents(dateStr)
      };
    }
  }
  // 安全備援
  const fallbackDate = new Date(fromDateObj.getTime() + 86400000);
  return {
    date: fallbackDate,
    dateStr: Utilities.formatDate(fallbackDate, 'GMT+8', 'yyyy-MM-dd'),
    dayZh: getDayOfWeekZh(fallbackDate.getDay()),
    holidayInfo: { isHoliday: false, isSchoolDay: true, reason: '常規教學日' },
    calendarEvents: []
  };
}

function getCalendarEvents(dateStr) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.CALENDAR);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getDataRange().getValues();
  const events = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;
    const rowDateStr = safeFormatDate(row[0], 'yyyy-MM-dd');
    if (rowDateStr && rowDateStr === dateStr) {
      events.push(String(row[1] || '活動') + (row[2] ? ` (${row[2]})` : ''));
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
    if (!data[i] || !data[i][0]) continue;
    const rowDateStr = safeFormatDate(data[i][0], 'yyyy-MM-dd');
    if (rowDateStr && rowDateStr === dateStr) {
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
  let categoryMap = { '文具教材': 0, '活動點心': 0, '教室佈置': 0, '各類雜支': 0 };

  const ss = getSpreadsheet();

  // 1. 班費收支
  const expSheet = ss.getSheetByName(CONFIG.SHEETS.EXPENSES);
  if (expSheet && expSheet.getLastRow() > 1) {
    const data = expSheet.getRange(2, 1, expSheet.getLastRow() - 1, 6).getValues();
    expenses = data
      .filter(r => r && r[0])
      .map(r => {
        const amt = Number(r[4]) || 0;
        totalExpense += amt;
        const cat = r[2] || '各類雜支';
        if (!categoryMap[cat]) categoryMap[cat] = 0;
        categoryMap[cat] += amt;
        return {
          date: safeFormatDate(r[0], 'yyyy-MM-dd') || String(r[0]),
          item: r[1],
          category: cat,
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
    incidents = data
      .filter(r => r && r[0])
      .map(r => ({
        time: safeFormatDate(r[0], 'MM-dd HH:mm') || String(r[0]),
        student: r[1],
        type: r[2],
        description: r[3],
        status: r[4]
      })).reverse();
  }

  // 3. 今日待辦
  const currentPlan = getSavedPlan(todayStr) || '今日尚未產生客製化節次待辦（可於 06:30 晨間或 20:00 復盤自動產出）';

  // 4. 計算期中考倒數（2026-11-05）
  const examDate = new Date('2026-11-05');
  const diffTime = examDate.getTime() - today.getTime();
  const examCountdown = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // 5. 抓取近期 5 筆學校行事
  const upcomingEvents = getUpcomingCalendarEvents(todayStr, 6);

  return {
    className: CONFIG.CLASS_NAME,
    today: todayStr,
    dayZh: dayZh,
    uniform: CONFIG.UNIFORMS[dayZh] || '便服',
    examCountdown: examCountdown > 0 ? examCountdown : 0,
    finance: {
      studentCount: CONFIG.STUDENT_COUNT,
      feePerStudent: CONFIG.CLASS_FEE_PER_STUDENT,
      totalIncome: totalIncome,
      totalExpense: totalExpense,
      balance: totalIncome - totalExpense,
      categories: categoryMap
    },
    schedule: getScheduleByDay(dayZh),
    calendarEvents: getCalendarEvents(todayStr),
    upcomingEvents: upcomingEvents,
    todayPlan: currentPlan,
    curriculumProgress: CONFIG.CURRICULUM_PROGRESS,
    recentExpenses: expenses.slice(0, 10),
    recentIncidents: incidents.slice(0, 10)
  };
}

function getUpcomingCalendarEvents(fromDateStr, limit) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.CALENDAR);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;
    const rowDateStr = safeFormatDate(row[0], 'yyyy-MM-dd');
    if (rowDateStr && rowDateStr >= fromDateStr) {
      list.push({
        date: rowDateStr,
        name: row[1],
        note: row[2] || ''
      });
      if (list.length >= (limit || 6)) break;
    }
  }
  return list;
}

// ======================== 【Gemini API 底層呼叫模組】 ========================

function callGeminiText(prompt) {
  const apiKey = CONFIG.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
    return '【提示】尚未設定 GEMINI_API_KEY，請至 Apps Script 專案設定中加入金鑰。';
  }

  const models = [CONFIG.GEMINI_MODEL || 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash'];
  for (let m = 0; m < models.length; m++) {
    const model = models[m];
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
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
      if (json.candidates && json.candidates[0].content && json.candidates[0].content.parts && json.candidates[0].content.parts[0].text) {
        return json.candidates[0].content.parts[0].text.trim();
      }
    } catch (e) {
      console.warn(`Gemini 模型 ${model} 呼叫失敗，嘗試備援模型: ` + e.toString());
    }
  }
  throw new Error('Gemini API 連線失敗，已嘗試多組備援模型。');
}

function callGeminiVision(base64Data, mimeType, prompt) {
  const apiKey = CONFIG.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
    return '【提示】尚未設定 GEMINI_API_KEY，請至 Apps Script 專案設定中加入金鑰。';
  }

  const models = [CONFIG.GEMINI_MODEL || 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash'];
  for (let m = 0; m < models.length; m++) {
    const model = models[m];
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
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
      if (json.candidates && json.candidates[0].content && json.candidates[0].content.parts && json.candidates[0].content.parts[0].text) {
        return json.candidates[0].content.parts[0].text.trim();
      }
    } catch (e) {
      console.warn(`Gemini Vision 模型 ${model} 呼叫失敗，嘗試備援模型: ` + e.toString());
    }
  }
  throw new Error('Gemini Vision API 連線失敗，已嘗試多組備援模型。');
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
  const status = res.getResponseCode();
  const content = res.getContentText();
  console.log(`LINE API 回應代碼 [${status}]: ${content}`);
  if (status !== 200) {
    console.error(`⚠️ LINE API 呼叫異常 [${status}]: ${content}`);
  }
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
    if (!row || !row[0]) continue;
    const rowDate = safeFormatDate(row[0], 'yyyy-MM-dd');
    if (rowDate && rowDate === dateStr) {
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

  // 3. 寫入 115 四上最新真實教學進度與未教單元追蹤
  const progSheet = getOrCreateSheet(ss, CONFIG.SHEETS.PROGRESS, ['科目', '教科書版本', '期中考範圍', '目前進度', '尚未教學單元', '下週攻堅目標', '期中衝刺策略']);
  progSheet.clearContents();
  progSheet.appendRow(['科目', '教科書版本', '期中考範圍', '目前進度', '尚未教學單元', '下週攻堅目標', '期中衝刺策略']);
  progSheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#dbeafe');

  const realProgress = [
    ['數學', '南一 4上', '單元一～五 (P.6-P.75)', '✅ 已全數教完', '無（進入全單元螺旋複習）', '10/26-10/30 進行單元一～五總複習、除法與三角形錯題診斷', '針對除法估商補零、等腰正三角形內角和性質精熟練習'],
    ['國語', '翰林 4上', '第1課～第6課、統整一、二', '⏳ 進行中（第1~5課教完，第6課教完前3段）', '第6課第四段、統整活動（一）、統整活動（二）', '10/26教第6課第四段；10/27教統整活動一；10/28-29教統整活動二', '依命題雙向細目表精熟字音字形、六何法閱讀理解與讀報策略'],
    ['社會', '康軒 4上', '第一單元、第二單元', '⏳ 進行中（第一單元家鄉自然環境已教完）', '第二單元《家鄉的傳統住屋與器物》（2-1住屋、2-2器物、小小探究家）', '10/27教2-1傳統住屋；10/28教2-2器物與生活；結合老街校本探究', '就地取材建築智慧、生活器物演變與先民生活調適實作探究'],
    ['作文', '統整/校訂', '期中前完成 4 篇', '⏳ 尚缺 1 篇', '第 4 篇作文（尚缺一篇）', '10/29(四) 第5、6節綜合活動寫作引導；10/30(五) 謄稿互評', '結合統整活動二「我最敬佩的人」或「家鄉的一景」審題立意選材'],
    ['家長通知', '官方帳號推播', '期中考前範圍圖文海報', '⏳ 待製作', '下週五 (10/30) 需製作期中考前範圍圖發送給家長', '10/30(五) 完成圖文海報排版並由官方帳號推播至家長LINE', '清晰列出考科範圍、題型分佈與複習注意事項，安撫家長焦慮']
  ];
  progSheet.getRange(2, 1, realProgress.length, 7).setValues(realProgress);

  console.log('✅ 四年丙班 (304) 真實課表（34節次）、115學年度重大行事（33項）與真實教學進度基準表已全數更新完畢！');
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

${getCurriculumPromptContext()}

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
