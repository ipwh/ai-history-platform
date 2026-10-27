/**
 * 香港中學歷史科專名同義詞庫（中一至中六）。
 *
 * 背景：學生作答填充題時，同一個歷史概念常有幾種都正確的寫法——
 *   - 教科書用全稱（「第一次世界大戰」），學生多寫簡稱（「一戰」）；
 *   - 本地慣用譯名（「希特拉」）與台灣／內地譯名（「希特勒」）並存；
 *   - 舊譯名（「江寧條約」）與課程慣用名（「南京條約」）指同一件事；
 *   - 學生可能以簡體字輸入。
 * 逐字比對會把這些**正確的答案**判錯，令學生誤以為自己記錯史實。
 *
 * 這一層只處理「同一個專有名詞的不同寫法」，不判斷語意，因此：
 *   - 名稱相近但指不同事物的**不會**放在同一組（例如「第一次世界大戰」與
 *     「第二次世界大戰」、「拿破崙」與「拿破崙三世」）。
 *   - 有歧義的簡稱（例如「新政」可指清末新政或羅斯福新政）不收錄，
 *     寧可交由教師覆核，也不要把錯誤答案判成正確。
 *
 * 詞庫按教育局《歷史科課程指引》（中一至中三）及高中歷史課程的學習範疇分組，
 * 方便日後對照課程修訂。
 */

export type HistoryTermCategory =
  /** 時序與重大事件 */
  | "event"
  /** 條約與協定 */
  | "treaty"
  /** 歷史改革與制度 */
  | "reform"
  /** 歷史人物 */
  | "person"
  /** 文明、組織及其他制度性專名 */
  | "institution";

export interface HistoryTermGroup {
  /** 課程慣用寫法（亦即填充題標準答案的寫法） */
  canonical: string;
  /** 學生可能輸入而同樣正確的其他寫法（簡稱、英文、舊譯、本地／外地慣用譯名、簡體字） */
  aliases: string[];
  category: HistoryTermCategory;
  /** 所屬學習範疇，只作整理及除錯用途 */
  scope: string;
}

/**
 * 簡體字轉繁體字的字元對照（只收錄歷史科專名常見字）。
 *
 * 以「簡體＋繁體」成對的字串表示，載入時拆成對照表。刻意不做整段文字轉換：
 * 詞庫只比對專有名詞，寧缺勿濫；未收錄的字元維持原樣，最壞情況是判為不匹配，
 * 不會把不相關的答案判成正確。
 */
const SIMPLIFIED_TRADITIONAL_PAIRS = [
  "战戰 条條 约約 马馬 尔爾 华華 国國 罗羅 维維 兴興 亚亞 历歷 军軍 苏蘇 联聯",
  "义義 运運 动動 开開 关關 协協 议議 权權 变變 长長 门門 问問 时時 间間 际際",
  "贸貿 经經 济濟 农農 业業 产產 资資 银銀 铁鐵 钢鋼 车車 东東 广廣 岛島 湾灣",
  "龙龍 张張 刘劉 陈陳 郑鄭 孙孫 汉漢 满滿 萨薩 逊遜 鲁魯 泽澤 谢謝 邓鄧 领領",
  "导導 书書 学學 术術 复復 旧舊 陆陸 队隊 卫衛 击擊 敌敵 胜勝 败敗 机機 构構",
  "设設 计計 划劃 处處 图圖 团團 围圍 墙牆 场場 县縣 乡鄉 镇鎮 庄莊 岁歲 万萬",
  "纪紀 统統 独獨 争爭 欧歐 纲綱 赔賠 舰艦 兰蘭 爱愛 纳納 轴軸 袭襲 韩韓 枪槍",
  "弹彈 试試 医醫 疗療 员員 护護 腊臘 邮郵 誉譽 专專 属屬 双雙 签簽 订訂 废廢",
  "让讓 转轉 税稅 萧蕭 诺諾 闪閃 电電 绥綏 营營 杀殺 犹猶 乔喬 钦欽 体體 顿頓",
  "内內 会會 组組 织織 总總 货貨 币幣 强強 绪緒 荣榮 启啟 举舉 宪憲 则則 鸿鴻",
  "为為 蒋蔣 仑崙 宁寧 达達 卢盧 垦墾 隶隸 党黨 丰豐 众眾 优優 伟偉 传傳 伤傷",
  "伪偽 侠俠 伦倫 债債 倾傾 偿償 储儲 农農 冯馮 决決 况況 冻凍 净淨 减減 凉涼",
  "凤鳳 凯凱 击擊 刘劉 则則 刚剛 创創 删刪 别別 剂劑 剑劍 剧劇 劝勸 办辦 务務",
  "励勵 劲勁 劳勞 势勢 勋勳 区區 医醫 单單 卖賣 卫衛 却卻 厂廠 厅廳 厉厲 压壓",
  "厌厭 县縣 参參 变變 叙敘 叠疊 叶葉 号號 叹嘆 后後 听聽 启啟 吴吳 员員 呛嗆",
  "呜嗚 响響 哑啞 哗嘩 唤喚 啧嘖 喷噴 嘱囑 团團 园園 围圍 国國 图圖 圆圓 圣聖",
  "场場 坏壞 块塊 坚堅 坛壇 坝壩 坞塢 坟墳 坠墜 垄壟 垒壘 垦墾 垫墊 墙牆 壮壯",
  "声聲 壳殼 壶壺 处處 备備 够夠 头頭 夹夾 夺奪 奋奮 奖獎 奥奧 妆妝 妇婦 妈媽",
  "娱娛 娲媧 娴嫻 婴嬰 婵嬋 孙孫 学學 宁寧 宝寶 实實 宠寵 审審 宪憲 宫宮 宽寬",
  "宾賓 寝寢 对對 寻尋 导導 寿壽 尘塵 尝嘗 尧堯 尽盡 层層 届屆 属屬 屡屢 屿嶼",
  "岂豈 岗崗 岛島 岭嶺 峡峽 峥崢 峦巒 崭嶄 巩鞏 币幣 帅帥 师師 帐帳 帘簾 帜幟",
  "带帶 帮幫 并並 广廣 庄莊 庆慶 庐廬 库庫 应應 庙廟 庞龐 废廢 开開 异異 弃棄",
  "弥彌 弯彎 强強 归歸 当當 录錄 彻徹 径徑 忆憶 忧憂 怀懷 态態 怜憐 总總 恋戀",
  "恳懇 恶惡 恼惱 悦悅 悬懸 悯憫 惊驚 惧懼 惨慘 惩懲 惫憊 惭慚 惯慣 愤憤 愿願",
  "懒懶 戏戲 战戰 户戶 扑撲 执執 扩擴 扫掃 扬揚 扰擾 抚撫 抢搶 护護 报報 担擔",
  "拟擬 拢攏 拣揀 拥擁 拦攔 拧擰 拨撥 择擇 挂掛 挚摯 挛攣 挟挾 挠撓 挡擋 挣掙",
  "挤擠 挥揮 捞撈 损損 捡撿 换換 捣搗 据據 掷擲 揽攬 搀攙 搁擱 搂摟 搅攪 携攜",
  "摄攝 摆擺 摇搖 摊攤 撑撐 撵攆 攒攢 敌敵 敛斂 数數 斋齋 斗鬥 斩斬 断斷 无無",
  "旧舊 时時 旷曠 昼晝 显顯 晋晉 晒曬 晓曉 晕暈 暂暫 术術 机機 杀殺 杂雜 权權",
  "条條 来來 杨楊 杰傑 极極 构構 枢樞 枪槍 枫楓 柜櫃 柠檸 标標 栈棧 栋棟 栎櫟",
  "栏欄 树樹 样樣 桩樁 梦夢 检檢 楼樓 榄欖 横橫 樱櫻 橱櫥 欢歡 欧歐 歼殲 残殘",
  "殒殞 殓殮 殡殯 殴毆 毁毀 毕畢 毙斃 气氣 氢氫 汇匯 汉漢 汤湯 沟溝 没沒 沥瀝",
  "沦淪 沧滄 沪滬 泞濘 泪淚 泷瀧 泸瀘 泻瀉 泼潑 泽澤 泾涇 洁潔 洒灑 浅淺 浆漿",
  "浇澆 浊濁 测測 济濟 浏瀏 浑渾 浓濃 涛濤 涝澇 涟漣 涡渦 涣渙 涤滌 润潤 涧澗",
  "涨漲 涩澀 渊淵 渍漬 渎瀆 渐漸 渔漁 渗滲 温溫 游遊 湾灣 湿濕 溃潰 溅濺 滚滾",
  "滞滯 满滿 滤濾 滥濫 滨濱 滩灘 潇瀟 潜潛 澜瀾 濑瀨 濒瀕 灭滅 灯燈 灵靈 灾災",
  "灿燦 炉爐 点點 炼煉 烁爍 烂爛 烛燭 烦煩 烧燒 烫燙 烬燼 热熱 焕煥 爱愛 爷爺",
  "牵牽 牺犧 犊犢 状狀 犹猶 狈狽 狞獰 独獨 狭狹 狮獅 狱獄 猎獵 猪豬 猫貓 献獻",
  "玑璣 玛瑪 玮瑋 环環 现現 玺璽 珑瓏 琏璉 琐瑣 琼瓊 瑶瑤 璎瓔 瓒瓚 瓯甌 电電",
  "画畫 畅暢 畴疇 疗療 疟瘧 疡瘍 疮瘡 疯瘋 痉痙 痒癢 痪瘓 痫癇 瘫癱 瘾癮 癫癲",
  "皱皺 盏盞 盐鹽 监監 盖蓋 盗盜 盘盤 睁睜 睐睞 睑瞼 瞒瞞 瞩矚 矫矯 矶磯 矾礬",
  "矿礦 码碼 砖磚 砚硯 砺礪 砾礫 础礎 硕碩 确確 碍礙 碱鹼 礼禮 祎禕 祷禱 祸禍",
  "禄祿 禅禪 离離 秃禿 种種 积積 称稱 秽穢 税稅 稣穌 稳穩 穷窮 窃竊 窍竅 窑窯",
  "窜竄 窝窩 窥窺 竖豎 竞競 笃篤 笋筍 笔筆 笺箋 笼籠 筑築 筛篩 筹籌 签簽 简簡",
  "箩籮 箪簞 箫簫 篓簍 篮籃 篱籬 类類 粤粵 粪糞 粮糧 紧緊 纠糾 红紅 纤纖 约約",
  "级級 纪紀 纫紉 纬緯 纯純 纱紗 纲綱 纳納 纵縱 纶綸 纷紛 纸紙 纹紋 纺紡 纽紐",
  "线線 练練 组組 绅紳 细細 织織 终終 绊絆 绍紹 绎繹 经經 绑綁 绒絨 结結 绕繞",
  "绘繪 给給 绚絢 络絡 绝絕 绞絞 统統 绢絹 绣繡 绥綏 继繼 绩績 绪緒 绫綾 续續",
  "绮綺 绯緋 绰綽 绳繩 维維 绵綿 绷繃 绸綢 综綜 绽綻 绿綠 缀綴 缄緘 缅緬 缆纜",
  "缉緝 缎緞 缓緩 缔締 缕縷 编編 缘緣 缚縛 缝縫 缠纏 缤繽 缨纓 缩縮 缪繆 缭繚",
  "缮繕 缰韁 缴繳 罂罌 网網 罗羅 罚罰 罢罷 羁羈 羡羨 翘翹 耸聳 耻恥 聂聶 聋聾",
  "职職 联聯 聪聰 肃肅 肠腸 肤膚 肾腎 肿腫 胀脹 胁脅 胆膽 胜勝 胫脛 胶膠 脉脈",
  "脏臟 脐臍 脑腦 脓膿 脚腳 脱脫 脸臉 腊臘 腻膩 腾騰 舆輿 舰艦 舱艙 芜蕪 芦蘆",
  "苇葦 苍蒼 苏蘇 苹蘋 茎莖 茧繭 荐薦 荚莢 荞蕎 荟薈 荡蕩 荣榮 荤葷 药藥 莅蒞",
  "莱萊 莲蓮 获獲 莹瑩 莺鶯 萝蘿 萤螢 营營 萦縈 萧蕭 萨薩 葱蔥 蒋蔣 蓝藍 蓟薊",
  "蔷薔 蔺藺 虏虜 虑慮 虚虛 虫蟲 虽雖 虾蝦 蚀蝕 蚁蟻 蚂螞 蚕蠶 蛊蠱 蛎蠣 蛮蠻",
  "蛰蟄 蜗蝸 蜡蠟 蝇蠅 蝉蟬 蝼螻 衅釁 衔銜 补補 衬襯 袄襖 袅裊 袜襪 袭襲 装裝",
  "裆襠 裤褲 褛褸 褴襤 见見 观觀 规規 觅覓 视視 览覽 觉覺 觊覬 觎覦 觐覲 觑覷",
  "触觸 誉譽 誊謄 计計 订訂 认認 讥譏 讨討 让讓 讪訕 讫訖 训訓 议議 讯訊 记記",
  "讲講 讳諱 讴謳 讶訝 讷訥 许許 讹訛 论論 讼訟 讽諷 设設 访訪 诀訣 证證 诂詁",
  "诃訶 评評 诅詛 识識 诈詐 诉訴 诊診 诋詆 词詞 诏詔 译譯 诒詒 诓誆 诔誄 试試",
  "诖詿 诗詩 诘詰 诙詼 诚誠 诛誅 话話 诞誕 诟詬 诠詮 诡詭 询詢 诣詣 诤諍 该該",
  "详詳 诧詫 诨諢 诩詡 诫誡 诬誣 语語 诮誚 误誤 诰誥 诱誘 诲誨 诳誑 说說 诵誦",
  "请請 诸諸 诺諾 读讀 诽誹 课課 诿諉 谁誰 调調 谄諂 谅諒 谆諄 谈談 谊誼 谋謀",
  "谌諶 谍諜 谎謊 谏諫 谐諧 谑謔 谒謁 谓謂 谕諭 谗讒 谙諳 谚諺 谛諦 谜謎 谟謨",
  "谡謖 谢謝 谣謠 谤謗 谦謙 谧謐 谨謹 谩謾 谪謫 谬謬 谭譚 谱譜 谴譴 谷穀 贝貝",
  "贞貞 负負 贡貢 财財 责責 贤賢 败敗 账賬 货貨 质質 贩販 贪貪 贫貧 贬貶 购購",
  "贮貯 贯貫 贰貳 贱賤 贲賁 贴貼 贵貴 贷貸 贸貿 费費 贺賀 贻貽 贼賊 贾賈 贿賄",
  "赁賃 赂賂 赃贓 资資 赈賑 赊賒 赋賦 赌賭 赎贖 赏賞 赐賜 赓賡 赔賠 赖賴 赘贅",
  "赚賺 赛賽 赞贊 赠贈 赡贍 赢贏 赣贛 赵趙 赶趕 趋趨 跃躍 跄蹌 践踐 跷蹺 跸蹕",
  "跻躋 踊踴 踌躊 踪蹤 踬躓 踯躑 蹑躡 蹒蹣 蹰躕 蹿躥 躏躪 躯軀 车車 轧軋 轨軌",
  "轩軒 轫軔 转轉 轭軛 轮輪 软軟 轰轟 轴軸 轶軼 轸軫 轻輕 轼軾 载載 轿轎 较較",
  "辄輒 辅輔 辆輛 辇輦 辈輩 辉輝 辊輥 辍輟 辎輜 辐輻 辑輯 输輸 辔轡 辕轅 辖轄",
  "辗輾 辘轆 辙轍 辞辭 辩辯 辫辮 边邊 辽遼 达達 迁遷 过過 迈邁 运運 还還 这這",
  "进進 远遠 违違 连連 迟遲 适適 选選 逊遜 递遞 逻邏 遗遺 遥遙 邓鄧 邝鄺 邬鄔",
  "邮郵 邹鄒 邺鄴 郑鄭 郓鄆 郦酈 郧鄖 郸鄲 酝醞 酱醬 酿釀 释釋 鉴鑑 銮鑾 针針",
  "钉釘 钊釗 钋釙 钌釕 钍釷 钎釺 钏釧 钐釤 钒釩 钓釣 钕釹 钗釵 钙鈣 钚鈈 钛鈦",
  "钜鉅 钝鈍 钞鈔 钟鐘 钠鈉 钡鋇 钢鋼 钣鈑 钤鈐 钥鑰 钦欽 钧鈞 钨鎢 钩鉤 钪鈧",
  "钫鈁 钬鈥 钭鈄 钮鈕 钯鈀 钰鈺 钱錢 钲鉦 钳鉗 钴鈷 钵缽 钶鈳 钸鈽 钹鈸 钺鉞",
  "钻鑽 钼鉬 钽鉭 钾鉀 铀鈾 铁鐵 铂鉑 铃鈴 铄鑠 铅鉛 铆鉚 铈鈰 铉鉉 铊鉈 铋鉍",
  "铌鈮 铍鈹 铎鐸 铐銬 铑銠 铒鉺 铕銪 铖鋮 铗鋏 铙鐃 铛鐺 铜銅 铝鋁 铟銦 铠鎧",
  "铡鍘 铢銖 铣銑 铤鋌 铧鏵 铨銓 铩鎩 铬鉻 铭銘 铮錚 铯銫 铰鉸 铱銥 铲鏟 铳銃",
  "铵銨 银銀 铷銣 铸鑄 铺鋪 铼錸 链鏈 铿鏗 销銷 锁鎖 锂鋰 锄鋤 锅鍋 锆鋯 锇鋨",
  "锈鏽 锉銼 锋鋒 锌鋅 锏鐧 锐銳 锑銻 锒鋃 锔鋦 锗鍺 错錯 锚錨 锛錛 锝鍀 锞錁",
  "锟錕 锡錫 锢錮 锣鑼 锤錘 锥錐 锦錦 锨鍁 锭錠 键鍵 锯鋸 锰錳 锱錙 锲鍥 锴鍇",
  "锵鏘 锶鍶 锷鍔 锹鍬 锺鍾 锻鍛 锼鎪 镀鍍 镁鎂 镂鏤 镇鎮 镉鎘 镊鑷 镌鎸 镍鎳",
  "镏鎦 镐鎬 镑鎊 镒鎰 镓鎵 镔鑌 镕鎔 镖鏢 镗鏜 镘鏝 镛鏞 镜鏡 镝鏑 镞鏃 镟鏇",
  "镣鐐 镦鐓 镧鑭 镨鐠 镪鏹 镫鐙 镬鑊 镭鐳 镯鐲 镰鐮 镲鑔 镳鑣 镶鑲 长長 门門",
  "闩閂 闪閃 闫閆 闭閉 问問 闯闖 闰閏 闱闈 闲閒 闳閎 间間 闵閔 闷悶 闸閘 闹鬧",
  "闺閨 闻聞 闼闥 闽閩 闾閭 阀閥 阁閣 阂閡 阃閫 阅閱 阆閬 阈閾 阉閹 阊閶 阋鬩",
  "阌閿 阍閽 阎閻 阐闡 阑闌 阔闊 阕闋 阖闔 阗闐 阙闕 阚闞 队隊 阳陽 阴陰 阵陣",
  "阶階 际際 陆陸 陇隴 陈陳 陕陝 陨隕 险險 随隨 隐隱 隶隸 难難 雏雛 雠讎 雳靂",
  "雾霧 霁霽 霉黴 霭靄 靓靚 静靜 靥靨 鞑韃 鞒鞽 鞯韉 韦韋 韧韌 韩韓 韪韙 韫韞",
  "韬韜 韵韻 页頁 顶頂 顷頃 项項 顺順 须須 顽頑 顾顧 顿頓 颀頎 颁頒 颂頌 预預",
  "颅顱 领領 颇頗 颈頸 颉頡 颊頰 颌頜 颍潁 颏頦 颐頤 频頻 颓頹 颔頷 颖穎 颗顆",
  "题題 颚顎 颛顓 颜顏 额額 颞顳 颟顢 颠顛 颡顙 颢顥 颤顫 颦顰 颧顴 风風 飏颺",
  "飒颯 飓颶 飕颼 飘飄 飙飆 飞飛 飨饗 餍饜 饥飢 饧餳 饨飩 饩餼 饪飪 饫飫 饬飭",
  "饭飯 饮飲 饯餞 饰飾 饱飽 饲飼 饴飴 饵餌 饶饒 饷餉 饺餃 饼餅 饽餑 饿餓 馀餘",
  "馁餒 馃餜 馄餛 馅餡 馆館 馈饋 馊餿 馋饞 馍饃 馏餾 馐饈 馑饉 馒饅 馔饌 馕饢",
  "马馬 驭馭 驮馱 驯馴 驰馳 驱驅 驳駁 驴驢 驶駛 驷駟 驹駒 驻駐 驼駝 驽駑 驾駕",
  "驿驛 骀駘 骁驍 骂罵 骄驕 骅驊 骆駱 骇駭 骈駢 骊驪 骋騁 验驗 骏駿 骐騏 骑騎",
  "骒騍 骗騙 骘騭 骚騷 骛騖 骜驁 骝騮 骞騫 骠驃 骡騾 骢驄 骤驟 骥驥 骧驤 髅髏",
  "髋髖 鬓鬢 魇魘 魉魎 鱼魚 鱿魷 鲁魯 鲂魴 鲅鮁 鲆鮃 鲇鯰 鲈鱸 鲋鮒 鲍鮑 鲎鱟",
  "鲐鮐 鲑鮭 鲒鮚 鲔鮪 鲕鮞 鲗鰂 鲛鮫 鲜鮮 鲞鯗 鲟鱘 鲠鯁 鲡鱺 鲢鰱 鲣鰹 鲤鯉",
  "鲥鰣 鲦鰷 鲧鯀 鲨鯊 鲩鯇 鲫鯽 鲭鯖 鲮鯪 鲰鯫 鲱鯡 鲲鯤 鲳鯧 鲴鯝 鲵鯢 鲶鯰",
  "鲷鯛 鲸鯨 鲻鯔 鲼鱝 鲽鰈 鳃鰓 鳄鱷 鳅鰍 鳆鰒 鳇鰉 鳊鯿 鳌鰲 鳍鰭 鳎鰨 鳏鰥",
  "鳐鰩 鳓鰳 鳔鰾 鳕鱈 鳖鱉 鳗鰻 鳙鱅 鳜鱖 鳝鱔 鳞鱗 鳟鱒 鳢鱧 鸟鳥 鸠鳩 鸡雞",
  "鸢鳶 鸣鳴 鸥鷗 鸦鴉 鸨鴇 鸩鴆 鸪鴣 鸫鶇 鸬鸕 鸭鴨 鸯鴦 鸱鴟 鸲鴝 鸳鴛 鸵鴕",
  "鸶鷥 鸷鷙 鸸鴯 鸹鴰 鸺鵂 鸽鴿 鸾鸞 鸿鴻 鹁鵓 鹂鸝 鹃鵑 鹄鵠 鹅鵝 鹆鵒 鹈鵜",
  "鹉鵡 鹊鵲 鹋鶓 鹌鵪 鹎鵯 鹏鵬 鹑鶉 鹕鶘 鹗鶚 鹘鶻 鹚鶿 鹛鶥 鹜鶩 鹞鷂 鹡鶺",
  "鹤鶴 鹦鸚 鹧鷓 鹨鷚 鹩鷯 鹪鷦 鹫鷲 鹬鷸 鹭鷺 鹰鷹 鹳鸛 麦麥 麸麩 黄黃 黉黌",
  "黩黷 黾黽 鼋黿 鼍鼉 鼹鼴 齐齊 齑齏 齿齒 龀齔 龃齟 龄齡 龅齙 龆齠 龇齜 龈齦",
  "龉齬 龊齪 龋齲 龌齷 龙龍 龚龔 龛龕 龟龜",
].join(" ");

const SIMPLIFIED_TO_TRADITIONAL: ReadonlyMap<string, string> = new Map(
  SIMPLIFIED_TRADITIONAL_PAIRS.split(/\s+/)
    .filter((pair) => pair.length === 2)
    .map((pair) => [pair[0], pair[1]] as const),
);

/** 作答比對前移除的標點及符號（含全形、半形及排版用的一點／兩點領導符） */
const IGNORED_PUNCTUATION =
  /[\s，。、；：？！「」『』（）()《》〈〉〔〕［］\[\]【】"'’‘“”,.;:!?—－・·\u2024-\u2027\u2026\-–~～…⋯＊*｜|／/]/g;

function toHalfWidth(value: string): string {
  return value
    .replace(/[\uff01-\uff5e]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ");
}

function toTraditional(value: string): string {
  let result = "";
  for (const char of value) {
    result += SIMPLIFIED_TO_TRADITIONAL.get(char) ?? char;
  }
  return result;
}

/**
 * 歷史科答案的標準化：過濾前後空白、全半形差異、標點及大小寫，並把簡體字轉為繁體。
 *
 * 只做字面收斂，不改變語意；同一函式同時用於學生答案及標準答案，確保兩邊以同一把尺比對。
 */
export function normalizeHistoryAnswer(value: string): string {
  return toTraditional(toHalfWidth(value.normalize("NFKC")))
    .replace(IGNORED_PUNCTUATION, "")
    .toLowerCase();
}

/**
 * 詞庫。每一組代表「同一個歷史專名」的不同寫法。
 *
 * 排序方式：先按學習範疇（課題），再按類別，方便對照課程文件增刪。
 * 加入新詞時請先確認：組內所有寫法在課程語境下**可以互相替代**。
 */
export const HISTORY_TERM_GROUPS: readonly HistoryTermGroup[] = [
  /* 課題1 人類的需要（古與今） */
  {
    canonical: "史前時期",
    aliases: ["史前時代", "prehistoric period"],
    category: "event",
    scope: "課題1",
  },
  {
    canonical: "石器時代",
    aliases: ["舊石器時代", "新石器時代", "stone age"],
    category: "event",
    scope: "課題1",
  },
  {
    canonical: "農業革命",
    aliases: ["新石器革命", "agricultural revolution", "neolithic revolution"],
    category: "reform",
    scope: "課題1",
  },
  {
    canonical: "兩河流域文明",
    aliases: ["美索不達米亞文明", "美索不達米亞", "mesopotamia"],
    category: "institution",
    scope: "課題1",
  },
  {
    canonical: "古埃及文明",
    aliases: ["埃及文明", "ancient egypt"],
    category: "institution",
    scope: "課題1",
  },
  {
    canonical: "印度河流域文明",
    aliases: ["古印度文明", "indus valley civilisation", "indus valley civilization"],
    category: "institution",
    scope: "課題1",
  },
  {
    canonical: "黃河流域文明",
    aliases: ["古中國文明", "華夏文明"],
    category: "institution",
    scope: "課題1",
  },
  {
    canonical: "楔形文字",
    aliases: ["釘頭文字", "cuneiform"],
    category: "institution",
    scope: "課題1",
  },
  {
    canonical: "象形文字",
    aliases: ["聖書體", "hieroglyphics", "hieroglyphs"],
    category: "institution",
    scope: "課題1",
  },
  {
    canonical: "甲骨文",
    aliases: ["甲骨文字", "oracle bone script"],
    category: "institution",
    scope: "課題1",
  },

  /* 課題2 歐洲文明的發展 */
  {
    canonical: "古希臘文明",
    aliases: ["希臘文明", "古希臘", "ancient greece"],
    category: "institution",
    scope: "課題2",
  },
  {
    canonical: "雅典民主政治",
    aliases: ["雅典民主", "雅典民主制", "athenian democracy"],
    category: "reform",
    scope: "課題2",
  },
  {
    canonical: "亞歷山大大帝",
    aliases: ["亞歷山大", "alexander the great"],
    category: "person",
    scope: "課題2",
  },
  {
    canonical: "羅馬共和國",
    aliases: ["羅馬共和", "roman republic"],
    category: "institution",
    scope: "課題2",
  },
  {
    canonical: "羅馬帝國",
    aliases: ["羅馬帝國時期", "roman empire"],
    category: "institution",
    scope: "課題2",
  },
  {
    canonical: "十二表法",
    aliases: ["十二銅表法", "twelve tables"],
    category: "reform",
    scope: "課題2",
  },
  {
    canonical: "拜占庭帝國",
    aliases: ["東羅馬帝國", "byzantine empire"],
    category: "institution",
    scope: "課題2",
  },
  {
    canonical: "封建制度",
    aliases: ["封建主義", "封建體制", "feudalism"],
    category: "reform",
    scope: "課題2",
  },
  {
    canonical: "莊園制度",
    aliases: ["莊園經濟", "莊園制", "manorialism"],
    category: "reform",
    scope: "課題2",
  },
  {
    canonical: "十字軍東征",
    aliases: ["十字軍", "crusades", "crusade"],
    category: "event",
    scope: "課題2",
  },
  {
    canonical: "黑死病",
    aliases: ["鼠疫", "瘟疫", "black death"],
    category: "event",
    scope: "課題2",
  },

  /* 課題3 伊斯蘭文明的興起 */
  {
    canonical: "伊斯蘭教",
    aliases: ["回教", "伊斯蘭", "islam"],
    category: "institution",
    scope: "課題3",
  },
  {
    canonical: "穆罕默德",
    aliases: ["穆聖", "muhammad", "mohammed"],
    category: "person",
    scope: "課題3",
  },
  {
    canonical: "古蘭經",
    aliases: ["可蘭經", "koran", "quran"],
    category: "institution",
    scope: "課題3",
  },
  {
    canonical: "哈里發",
    aliases: ["哈里發制度", "caliph", "caliphate"],
    category: "reform",
    scope: "課題3",
  },
  {
    canonical: "遜尼派",
    aliases: ["遜尼教派", "sunni", "sunnite"],
    category: "institution",
    scope: "課題3",
  },
  {
    canonical: "什葉派",
    aliases: ["什葉教派", "shia", "shiite"],
    category: "institution",
    scope: "課題3",
  },
  {
    canonical: "倭馬亞王朝",
    aliases: ["奧米亞王朝", "伍麥葉王朝", "umayyad caliphate", "umayyad"],
    category: "institution",
    scope: "課題3",
  },
  {
    canonical: "阿拔斯王朝",
    aliases: ["阿巴斯王朝", "abbasid caliphate", "abbasid"],
    category: "institution",
    scope: "課題3",
  },
  {
    canonical: "清真寺",
    aliases: ["回教寺", "mosque"],
    category: "institution",
    scope: "課題3",
  },

  /* 課題4 早期香港地區的歷史 */
  {
    canonical: "新界五大族",
    aliases: ["五大族", "新界五大氏族"],
    category: "institution",
    scope: "課題4",
  },
  {
    canonical: "圍村",
    aliases: ["圍屋", "wall village", "walled village"],
    category: "institution",
    scope: "課題4",
  },
  {
    canonical: "宗族",
    aliases: ["氏族", "家族制度", "clan"],
    category: "institution",
    scope: "課題4",
  },
  {
    canonical: "遷界令",
    aliases: ["遷海令", "遷界", "遷海"],
    category: "reform",
    scope: "課題4",
  },
  {
    canonical: "新安縣",
    aliases: ["新安", "寶安縣"],
    category: "institution",
    scope: "課題4",
  },
  {
    canonical: "九龍寨城",
    aliases: ["九龍城寨", "九龍寨", "kowloon walled city"],
    category: "institution",
    scope: "課題4",
  },
  {
    canonical: "屏山鄧氏",
    aliases: ["鄧氏宗族", "屏山鄧族"],
    category: "institution",
    scope: "課題4",
  },

  /* 課題5 近代歐洲的興起 */
  {
    canonical: "文藝復興",
    aliases: ["文藝復興運動", "renaissance"],
    category: "event",
    scope: "課題5",
  },
  {
    canonical: "人文主義",
    aliases: ["人文主義思想", "humanism"],
    category: "reform",
    scope: "課題5",
  },
  {
    canonical: "宗教改革",
    aliases: ["宗教改革運動", "reformation"],
    category: "reform",
    scope: "課題5",
  },
  {
    canonical: "馬丁路德",
    aliases: ["馬丁·路德", "路德", "martin luther", "luther"],
    category: "person",
    scope: "課題5",
  },
  {
    canonical: "九十五條論證",
    aliases: ["九十五條", "九十五條提綱", "ninety-five theses"],
    category: "event",
    scope: "課題5",
  },
  {
    canonical: "因信稱義",
    aliases: ["唯信稱義", "justification by faith"],
    category: "reform",
    scope: "課題5",
  },
  {
    canonical: "加爾文",
    aliases: ["喀爾文", "約翰加爾文", "john calvin", "calvin"],
    category: "person",
    scope: "課題5",
  },
  {
    canonical: "加爾文宗",
    aliases: ["喀爾文宗", "改革宗", "calvinism", "reformed church"],
    category: "institution",
    scope: "課題5",
  },
  {
    canonical: "路德宗",
    aliases: ["信義宗", "路德會", "lutheranism"],
    category: "institution",
    scope: "課題5",
  },
  {
    canonical: "英國國教",
    aliases: ["聖公會", "安立甘宗", "church of england", "anglican church"],
    category: "institution",
    scope: "課題5",
  },
  {
    canonical: "亨利八世",
    aliases: ["亨利第八", "henry viii"],
    category: "person",
    scope: "課題5",
  },
  {
    canonical: "反宗教改革",
    aliases: ["天主教反宗教改革", "counter-reformation"],
    category: "reform",
    scope: "課題5",
  },
  {
    canonical: "大航海時代",
    aliases: ["地理大發現", "發現新大陸", "age of discovery", "age of exploration"],
    category: "event",
    scope: "課題5",
  },
  {
    canonical: "哥倫布",
    aliases: ["哥倫布船隊", "christopher columbus", "columbus"],
    category: "person",
    scope: "課題5",
  },
  {
    canonical: "麥哲倫",
    aliases: ["麥哲倫船隊", "ferdinand magellan", "magellan"],
    category: "person",
    scope: "課題5",
  },
  {
    canonical: "達伽馬",
    aliases: ["瓦斯科達伽馬", "vasco da gama", "da gama"],
    category: "person",
    scope: "課題5",
  },
  {
    canonical: "科學革命",
    aliases: ["科學革命時期", "scientific revolution"],
    category: "event",
    scope: "課題5",
  },
  {
    canonical: "哥白尼",
    aliases: ["哥白尼學說", "nicolaus copernicus", "copernicus"],
    category: "person",
    scope: "課題5",
  },
  {
    canonical: "伽利略",
    aliases: ["伽利略伽利萊", "galileo", "galileo galilei"],
    category: "person",
    scope: "課題5",
  },
  {
    canonical: "牛頓",
    aliases: ["牛頓爵士", "isaac newton", "newton"],
    category: "person",
    scope: "課題5",
  },
  {
    canonical: "啟蒙運動",
    aliases: ["啟蒙時代", "enlightenment"],
    category: "event",
    scope: "課題5",
  },
  {
    canonical: "約翰洛克",
    aliases: ["洛克", "john locke", "locke"],
    category: "person",
    scope: "課題5",
  },
  {
    canonical: "孟德斯鳩",
    aliases: ["孟德斯鳩男爵", "montesquieu"],
    category: "person",
    scope: "課題5",
  },
  {
    canonical: "伏爾泰",
    aliases: ["福爾泰", "voltaire"],
    category: "person",
    scope: "課題5",
  },
  {
    canonical: "盧梭",
    aliases: ["讓雅克盧梭", "jean-jacques rousseau", "rousseau"],
    category: "person",
    scope: "課題5",
  },
  {
    canonical: "三權分立",
    aliases: ["三權分立制", "separation of powers"],
    category: "reform",
    scope: "課題5",
  },
  {
    canonical: "天賦人權",
    aliases: ["自然權利", "natural rights"],
    category: "reform",
    scope: "課題5",
  },
  {
    canonical: "社會契約",
    aliases: ["社會契約論", "social contract"],
    category: "reform",
    scope: "課題5",
  },

  /* 課題6 歐洲國家的殖民擴張（亦涵蓋高中中國近代史條約） */
  {
    canonical: "殖民主義",
    aliases: ["殖民主義政策", "colonialism"],
    category: "reform",
    scope: "課題6",
  },
  {
    canonical: "帝國主義",
    aliases: ["帝國主義政策", "imperialism"],
    category: "reform",
    scope: "課題6",
  },
  {
    canonical: "東印度公司",
    aliases: ["英國東印度公司", "east india company"],
    category: "institution",
    scope: "課題6",
  },
  {
    canonical: "鴉片戰爭",
    aliases: ["第一次鴉片戰爭", "opium war", "first opium war"],
    category: "event",
    scope: "課題6",
  },
  {
    canonical: "虎門銷煙",
    aliases: ["銷煙運動", "虎門銷煙事件"],
    category: "event",
    scope: "課題6",
  },
  {
    canonical: "南京條約",
    aliases: ["江寧條約", "treaty of nanking", "treaty of nanjing"],
    category: "treaty",
    scope: "課題6",
  },
  {
    canonical: "虎門條約",
    aliases: ["虎門條約及善後章程", "treaty of the bogue"],
    category: "treaty",
    scope: "課題6",
  },
  {
    canonical: "天津條約",
    aliases: ["英法聯軍之役天津條約", "treaty of tientsin", "treaty of tianjin"],
    category: "treaty",
    scope: "課題6",
  },
  {
    canonical: "北京條約",
    aliases: ["中英北京條約", "treaty of peking", "treaty of beijing"],
    category: "treaty",
    scope: "課題6",
  },
  {
    canonical: "馬關條約",
    aliases: ["下關條約", "treaty of shimonoseki"],
    category: "treaty",
    scope: "課題6",
  },
  {
    canonical: "辛丑條約",
    aliases: ["北京議定書", "boxer protocol"],
    category: "treaty",
    scope: "課題6",
  },
  {
    canonical: "璦琿條約",
    aliases: ["璦琿和約", "treaty of aigun"],
    category: "treaty",
    scope: "課題6",
  },
  {
    canonical: "展拓香港界址專條",
    aliases: ["展拓香港界址專條及香港新界租約", "租借新界", "convention for the extension of hong kong territory"],
    category: "treaty",
    scope: "課題6",
  },
  {
    canonical: "五口通商",
    aliases: ["五口通商口岸", "five treaty ports"],
    category: "reform",
    scope: "課題6",
  },
  {
    canonical: "租界",
    aliases: ["租借地", "concession"],
    category: "institution",
    scope: "課題6",
  },
  {
    canonical: "門戶開放政策",
    aliases: ["門戶開放", "open door policy"],
    category: "reform",
    scope: "課題6",
  },
  {
    canonical: "瓜分中國",
    aliases: ["瓜分風潮", "瓜分危機", "scramble for concessions"],
    category: "event",
    scope: "課題6",
  },
  {
    canonical: "柏林會議",
    aliases: ["柏林西非會議", "berlin conference"],
    category: "event",
    scope: "課題6",
  },
  {
    canonical: "蘇伊士運河",
    aliases: ["蘇彝士運河", "suez canal"],
    category: "institution",
    scope: "課題6",
  },

  /* 課題7 美國的成立及發展 */
  {
    canonical: "美國獨立宣言",
    aliases: ["獨立宣言", "declaration of independence"],
    category: "treaty",
    scope: "課題7",
  },
  {
    // 本校課程及教材用「美國革命」（教材 44 處，分節題為「美國革命與建國」）。
    canonical: "美國革命",
    aliases: ["美國獨立戰爭", "獨立戰爭", "american revolutionary war", "american war of independence"],
    category: "event",
    scope: "課題7",
  },
  {
    canonical: "喬治華盛頓",
    aliases: ["華盛頓", "george washington", "washington"],
    category: "person",
    scope: "課題7",
  },
  {
    canonical: "湯瑪斯傑佛遜",
    aliases: ["傑佛遜", "傑斐遜", "thomas jefferson", "jefferson"],
    category: "person",
    scope: "課題7",
  },
  {
    canonical: "美國憲法",
    aliases: ["1787年憲法", "聯邦憲法", "us constitution", "united states constitution"],
    category: "treaty",
    scope: "課題7",
  },
  {
    canonical: "美國南北戰爭",
    aliases: ["南北戰爭", "美國內戰", "american civil war", "civil war"],
    category: "event",
    scope: "課題7",
  },
  {
    canonical: "亞伯拉罕林肯",
    aliases: ["林肯", "abraham lincoln", "lincoln"],
    category: "person",
    scope: "課題7",
  },
  {
    canonical: "解放黑奴宣言",
    aliases: ["解放奴隸宣言", "解放宣言", "emancipation proclamation"],
    category: "treaty",
    scope: "課題7",
  },
  {
    canonical: "門羅主義",
    aliases: ["門羅宣言", "monroe doctrine"],
    category: "reform",
    scope: "課題7",
  },
  {
    canonical: "西進運動",
    aliases: ["西拓運動", "西進", "westward expansion"],
    category: "event",
    scope: "課題7",
  },
  {
    canonical: "經濟大蕭條",
    aliases: ["大蕭條", "大蕭條時期", "great depression"],
    category: "event",
    scope: "課題7",
  },
  {
    canonical: "羅斯福新政",
    aliases: ["新政計劃", "new deal"],
    category: "reform",
    scope: "課題7",
  },
  {
    canonical: "富蘭克林羅斯福",
    aliases: ["小羅斯福", "羅斯福總統", "franklin roosevelt", "franklin d. roosevelt", "fdr"],
    category: "person",
    scope: "課題7",
  },
  {
    canonical: "偷襲珍珠港",
    aliases: ["珍珠港事件", "偷襲珍珠港事件", "attack on pearl harbor", "pearl harbor"],
    category: "event",
    scope: "課題7",
  },

  /* 課題8 直至二十世紀初香港的成長與發展 */
  {
    canonical: "轉口港",
    aliases: ["轉口貿易", "entrepôt trade", "entrepot trade"],
    category: "institution",
    scope: "課題8",
  },
  {
    canonical: "香港開埠",
    aliases: ["開埠", "opening of the port"],
    category: "event",
    scope: "課題8",
  },
  {
    canonical: "東華醫院",
    aliases: ["東華三院", "tung wah hospital"],
    category: "institution",
    scope: "課題8",
  },
  {
    canonical: "保良局",
    aliases: ["保良局成立", "po leung kuk"],
    category: "institution",
    scope: "課題8",
  },
  {
    canonical: "團防局",
    aliases: ["團防局成立", "district watch committee"],
    category: "institution",
    scope: "課題8",
  },
  {
    canonical: "立法局",
    aliases: ["立法會", "legislative council", "legco"],
    category: "institution",
    scope: "課題8",
  },
  {
    canonical: "行政局",
    aliases: ["行政會議", "executive council", "exco"],
    category: "institution",
    scope: "課題8",
  },
  {
    canonical: "香港總督",
    aliases: ["港督", "總督", "governor of hong kong"],
    category: "person",
    scope: "課題8",
  },
  {
    canonical: "大潭水塘",
    aliases: ["大潭篤水塘", "tai tam reservoir"],
    category: "institution",
    scope: "課題8",
  },
  {
    canonical: "九廣鐵路",
    aliases: ["九廣鐵路英段", "kowloon-canton railway", "kcr"],
    category: "institution",
    scope: "課題8",
  },
  {
    canonical: "山頂纜車",
    aliases: ["太平山纜車", "peak tram"],
    category: "institution",
    scope: "課題8",
  },
  {
    canonical: "天星小輪",
    aliases: ["天星小輪公司", "star ferry"],
    category: "institution",
    scope: "課題8",
  },
  {
    canonical: "反蓄婢運動",
    aliases: ["廢除婢妾制度", "反婢運動"],
    category: "event",
    scope: "課題8",
  },

  /* 課題9 兩次世界大戰 */
  {
    canonical: "第一次世界大戰",
    aliases: ["一戰", "第一次大戰", "world war i", "wwi", "first world war", "great war"],
    category: "event",
    scope: "課題9",
  },
  {
    canonical: "第二次世界大戰",
    aliases: ["二戰", "第二次大戰", "world war ii", "wwii", "second world war"],
    category: "event",
    scope: "課題9",
  },
  {
    // 本校教材用「塞拉耶佛事件」（10 處）；「薩拉熱窩」為內地／台灣譯名。
    canonical: "塞拉耶佛事件",
    aliases: ["薩拉熱窩事件", "塞拉耶佛刺殺事件", "薩拉熱窩刺殺事件", "assassination of archduke franz ferdinand"],
    category: "event",
    scope: "課題9",
  },
  {
    canonical: "凡爾賽條約",
    aliases: ["凡爾賽和約", "treaty of versailles"],
    category: "treaty",
    scope: "課題9",
  },
  {
    canonical: "國際聯盟",
    aliases: ["國聯", "league of nations"],
    category: "treaty",
    scope: "課題9",
  },
  {
    canonical: "綏靖政策",
    aliases: ["綏靖主義", "appeasement", "appeasement policy"],
    category: "reform",
    scope: "課題9",
  },
  {
    canonical: "慕尼黑協定",
    aliases: ["慕尼黑協議", "munich agreement"],
    category: "treaty",
    scope: "課題9",
  },
  {
    canonical: "蘇德互不侵犯條約",
    aliases: ["德蘇互不侵犯條約", "莫洛托夫里賓特洛甫條約", "molotov-ribbentrop pact"],
    category: "treaty",
    scope: "課題9",
  },
  {
    canonical: "閃電戰",
    aliases: ["閃擊戰", "blitzkrieg"],
    category: "reform",
    scope: "課題9",
  },
  {
    canonical: "不列顛之戰",
    aliases: ["英倫空戰", "battle of britain"],
    category: "event",
    scope: "課題9",
  },
  {
    canonical: "諾曼第登陸",
    aliases: ["諾曼地登陸", "d-day", "normandy landings"],
    category: "event",
    scope: "課題9",
  },
  {
    canonical: "軸心國",
    aliases: ["軸心國集團", "axis powers", "axis"],
    category: "institution",
    scope: "課題9",
  },
  {
    canonical: "同盟國",
    aliases: ["同盟國集團", "allied powers", "allies"],
    category: "institution",
    scope: "課題9",
  },
  {
    canonical: "原子彈",
    aliases: ["核彈", "atomic bomb", "nuclear bomb"],
    category: "institution",
    scope: "課題9",
  },
  {
    canonical: "猶太人大屠殺",
    aliases: ["大屠殺", "holocaust", "the holocaust"],
    category: "event",
    scope: "課題9",
  },
  {
    canonical: "雅爾塔會議",
    aliases: ["雅爾塔協定", "yalta conference", "yalta agreement"],
    category: "treaty",
    scope: "課題9",
  },
  {
    canonical: "波茨坦會議",
    aliases: ["波茨坦公告", "potsdam conference", "potsdam declaration"],
    category: "treaty",
    scope: "課題9",
  },
  {
    // 本校教材及香港教科書用「希特拉」（教材 41 處），「希特勒」為台灣／內地譯名。
    canonical: "希特拉",
    aliases: ["希特勒", "阿道夫希特拉", "阿道夫希特勒", "adolf hitler", "hitler"],
    category: "person",
    scope: "課題9",
  },
  {
    canonical: "墨索里尼",
    aliases: ["墨索里尼首相", "benito mussolini", "mussolini"],
    category: "person",
    scope: "課題9",
  },
  {
    // 本校教材用「史太林」（37 處），「史達林」「斯大林」為其他地區譯名。
    canonical: "史太林",
    aliases: ["史達林", "斯大林", "joseph stalin", "stalin"],
    category: "person",
    scope: "課題9",
  },
  {
    canonical: "邱吉爾",
    aliases: ["丘吉爾", "溫斯頓邱吉爾", "winston churchill", "churchill"],
    category: "person",
    scope: "課題9",
  },
  {
    canonical: "威爾遜",
    aliases: ["威爾遜總統", "woodrow wilson", "wilson"],
    category: "person",
    scope: "課題9",
  },
  {
    canonical: "聯合國",
    aliases: ["聯合國組織", "united nations", "un"],
    category: "institution",
    scope: "課題9",
  },
  {
    canonical: "聯合國憲章",
    aliases: ["聯合國憲章簽署", "united nations charter", "un charter"],
    category: "treaty",
    scope: "課題9",
  },

  /* 課題10 冷戰及後冷戰時代 */
  {
    canonical: "冷戰",
    aliases: ["冷戰時期", "cold war"],
    category: "event",
    scope: "課題10",
  },
  {
    canonical: "鐵幕",
    aliases: ["鐵幕政策", "iron curtain"],
    category: "reform",
    scope: "課題10",
  },
  {
    canonical: "杜魯門主義",
    aliases: ["杜魯門 doctrine", "truman doctrine"],
    category: "reform",
    scope: "課題10",
  },
  {
    canonical: "馬歇爾計劃",
    aliases: ["馬歇爾計畫", "歐洲復興計劃", "marshall plan", "european recovery program"],
    category: "reform",
    scope: "課題10",
  },
  {
    canonical: "圍堵政策",
    aliases: ["遏制政策", "圍堵戰略", "containment", "containment policy"],
    category: "reform",
    scope: "課題10",
  },
  {
    canonical: "北大西洋公約組織",
    aliases: ["北約", "nato", "north atlantic treaty organization"],
    category: "institution",
    scope: "課題10",
  },
  {
    canonical: "華沙公約組織",
    aliases: ["華約", "warsaw pact", "warsaw treaty organization"],
    category: "institution",
    scope: "課題10",
  },
  {
    canonical: "柏林危機",
    aliases: ["柏林封鎖", "berlin blockade", "berlin crisis"],
    category: "event",
    scope: "課題10",
  },
  {
    canonical: "柏林圍牆",
    aliases: ["柏林牆", "berlin wall"],
    category: "institution",
    scope: "課題10",
  },
  {
    canonical: "古巴導彈危機",
    aliases: ["古巴飛彈危機", "cuban missile crisis"],
    category: "event",
    scope: "課題10",
  },
  {
    canonical: "韓戰",
    aliases: ["朝鮮戰爭", "korean war"],
    category: "event",
    scope: "課題10",
  },
  {
    canonical: "越戰",
    aliases: ["越南戰爭", "vietnam war"],
    category: "event",
    scope: "課題10",
  },
  {
    canonical: "蘇聯解體",
    aliases: ["蘇聯瓦解", "dissolution of the soviet union"],
    category: "event",
    scope: "課題10",
  },
  {
    canonical: "東歐劇變",
    aliases: ["東歐變天", "revolutions of 1989"],
    category: "event",
    scope: "課題10",
  },
  {
    canonical: "兩德統一",
    aliases: ["德國統一", "german reunification"],
    category: "event",
    scope: "課題10",
  },
  {
    canonical: "戈巴契夫",
    aliases: ["戈爾巴喬夫", "戈巴喬夫", "mikhail gorbachev", "gorbachev"],
    category: "person",
    scope: "課題10",
  },
  {
    canonical: "文化大革命",
    aliases: ["文革", "無產階級文化大革命", "cultural revolution"],
    category: "event",
    scope: "課題10",
  },
  {
    canonical: "改革開放",
    aliases: ["改革開放政策", "對外開放", "reform and opening up"],
    category: "reform",
    scope: "課題10",
  },
  {
    canonical: "九一一事件",
    aliases: ["911事件", "九一一襲擊", "september 11 attacks", "9/11"],
    category: "event",
    scope: "課題10",
  },
  {
    canonical: "全球化",
    aliases: ["全球一體化", "globalisation", "globalization"],
    category: "event",
    scope: "課題10",
  },

  /* 課題11 二十世紀以來的國際合作 */
  {
    canonical: "安全理事會",
    aliases: ["安理會", "聯合國安全理事會", "security council", "un security council"],
    category: "institution",
    scope: "課題11",
  },
  {
    canonical: "世界衛生組織",
    aliases: ["世衛", "世衛組織", "world health organization", "who"],
    category: "institution",
    scope: "課題11",
  },
  {
    canonical: "世界貿易組織",
    aliases: ["世貿", "世貿組織", "world trade organization", "wto"],
    category: "institution",
    scope: "課題11",
  },
  {
    canonical: "關稅及貿易總協定",
    aliases: ["關稅暨貿易總協定", "gatt", "general agreement on tariffs and trade"],
    category: "treaty",
    scope: "課題11",
  },
  {
    canonical: "國際貨幣基金組織",
    aliases: ["國際貨幣基金", "imf", "international monetary fund"],
    category: "institution",
    scope: "課題11",
  },
  {
    canonical: "世界銀行",
    aliases: ["世界銀行集團", "world bank"],
    category: "institution",
    scope: "課題11",
  },
  {
    canonical: "布雷頓森林體系",
    aliases: ["布雷頓森林協定", "布雷頓森林制度", "bretton woods system"],
    category: "treaty",
    scope: "課題11",
  },
  {
    canonical: "歐洲聯盟",
    aliases: ["歐盟", "european union", "eu"],
    category: "institution",
    scope: "課題11",
  },
  {
    canonical: "東南亞國家聯盟",
    aliases: ["東盟", "asean", "association of southeast asian nations"],
    category: "institution",
    scope: "課題11",
  },
  {
    canonical: "亞太經濟合作組織",
    aliases: ["亞太經合組織", "apec", "asia-pacific economic cooperation"],
    category: "institution",
    scope: "課題11",
  },
  {
    canonical: "世界人權宣言",
    aliases: ["人權宣言", "universal declaration of human rights"],
    category: "treaty",
    scope: "課題11",
  },
  {
    canonical: "日內瓦公約",
    aliases: ["日內瓦公約及附加議定書", "geneva conventions"],
    category: "treaty",
    scope: "課題11",
  },
  {
    canonical: "京都議定書",
    aliases: ["京都協議", "kyoto protocol"],
    category: "treaty",
    scope: "課題11",
  },
  {
    canonical: "巴黎協定",
    aliases: ["巴黎氣候協定", "paris agreement"],
    category: "treaty",
    scope: "課題11",
  },

  /* 課題12 二十世紀香港的成長與蛻變 */
  {
    canonical: "香港保衛戰",
    aliases: ["香港戰役", "battle of hong kong"],
    category: "event",
    scope: "課題12",
  },
  {
    canonical: "三年零八個月",
    aliases: ["日佔時期", "日治時期", "日本佔領時期", "three years and eight months"],
    category: "event",
    scope: "課題12",
  },
  {
    canonical: "東江縱隊",
    aliases: ["東江游擊隊", "東江縱隊港九獨立大隊", "east river column"],
    category: "institution",
    scope: "課題12",
  },
  {
    canonical: "徙置區",
    aliases: ["徙置屋邨", "徙置大廈", "resettlement area", "resettlement estate"],
    category: "institution",
    scope: "課題12",
  },
  {
    canonical: "公共屋邨",
    aliases: ["公屋", "公共房屋", "public housing"],
    category: "institution",
    scope: "課題12",
  },
  {
    canonical: "廉政公署",
    aliases: ["廉政專員公署", "icac", "independent commission against corruption"],
    category: "institution",
    scope: "課題12",
  },
  {
    canonical: "九年免費教育",
    aliases: ["普及教育", "九年普及教育", "nine-year free education"],
    category: "reform",
    scope: "課題12",
  },
  {
    canonical: "新市鎮",
    aliases: ["新市鎮發展", "new town", "new towns"],
    category: "institution",
    scope: "課題12",
  },
  {
    canonical: "中英聯合聲明",
    aliases: ["聯合聲明", "中英關於香港問題的聯合聲明", "sino-british joint declaration", "joint declaration"],
    category: "treaty",
    scope: "課題12",
  },
  {
    canonical: "一國兩制",
    aliases: ["一個國家兩種制度", "one country two systems"],
    category: "reform",
    scope: "課題12",
  },
  {
    canonical: "香港基本法",
    aliases: ["基本法", "香港特別行政區基本法", "basic law", "basic law of the hong kong sar"],
    category: "treaty",
    scope: "課題12",
  },
  {
    canonical: "香港特別行政區",
    aliases: ["香港特區", "特區", "hong kong sar", "hksar"],
    category: "institution",
    scope: "課題12",
  },
  {
    canonical: "香港回歸",
    aliases: ["回歸", "主權移交", "香港主權移交", "handover of hong kong"],
    category: "event",
    scope: "課題12",
  },
  {
    canonical: "亞洲金融風暴",
    aliases: ["金融風暴", "亞洲金融危機", "asian financial crisis"],
    category: "event",
    scope: "課題12",
  },
  {
    canonical: "嚴重急性呼吸系統綜合症",
    aliases: ["沙士", "非典型肺炎", "sars"],
    category: "event",
    scope: "課題12",
  },

  /* 高中：中國近代史 */
  {
    canonical: "洋務運動",
    aliases: ["自強運動", "同光新政", "洋務新政", "self-strengthening movement"],
    category: "reform",
    scope: "高中",
  },
  {
    canonical: "戊戌維新",
    aliases: ["百日維新", "戊戌變法", "維新運動", "hundred days' reform"],
    category: "reform",
    scope: "高中",
  },
  {
    canonical: "辛亥革命",
    aliases: ["革命黨起義", "1911年革命", "xinhai revolution"],
    category: "event",
    scope: "高中",
  },
  {
    canonical: "五四運動",
    aliases: ["五四", "may fourth movement"],
    category: "event",
    scope: "高中",
  },
  {
    canonical: "新文化運動",
    aliases: ["新文化運動時期", "new culture movement"],
    category: "event",
    scope: "高中",
  },
  {
    canonical: "抗日戰爭",
    aliases: ["抗戰", "八年抗戰", "第二次中日戰爭", "war of resistance", "second sino-japanese war"],
    category: "event",
    scope: "高中",
  },
  {
    canonical: "國共內戰",
    aliases: ["國共戰爭", "中國內戰", "chinese civil war"],
    category: "event",
    scope: "高中",
  },
  {
    canonical: "科舉制度",
    aliases: ["科舉", "科舉制", "imperial examination"],
    category: "reform",
    scope: "高中",
  },
  {
    canonical: "中央集權",
    aliases: ["中央集權制度", "中央集權制", "centralisation of power"],
    category: "reform",
    scope: "高中",
  },
  {
    canonical: "郡縣制",
    aliases: ["郡縣制度", "commandery and county system"],
    category: "reform",
    scope: "高中",
  },
  {
    canonical: "三省六部制",
    aliases: ["三省六部", "three departments and six ministries"],
    category: "reform",
    scope: "高中",
  },
  {
    canonical: "君主立憲制",
    aliases: ["君主立憲", "立憲君主制", "constitutional monarchy"],
    category: "reform",
    scope: "高中",
  },
  {
    canonical: "共和制",
    aliases: ["共和政體", "民主共和", "republic"],
    category: "reform",
    scope: "高中",
  },
  {
    canonical: "聯邦制",
    aliases: ["聯邦制度", "federalism", "federal system"],
    category: "reform",
    scope: "高中",
  },
  {
    canonical: "計劃經濟",
    aliases: ["計畫經濟", "計劃經濟體制", "planned economy"],
    category: "reform",
    scope: "高中",
  },
  {
    canonical: "市場經濟",
    aliases: ["市場經濟體制", "market economy"],
    category: "reform",
    scope: "高中",
  },
  {
    canonical: "五年計劃",
    aliases: ["五年計畫", "five-year plan"],
    category: "reform",
    scope: "高中",
  },
  {
    canonical: "人民公社",
    aliases: ["人民公社制度", "people's commune"],
    category: "reform",
    scope: "高中",
  },

  /* 高中：世界近代史 */
  {
    canonical: "明治維新",
    aliases: ["明治變法", "明治改革", "meiji restoration", "meiji reform"],
    category: "reform",
    scope: "高中",
  },
  {
    canonical: "甲午戰爭",
    aliases: ["中日甲午戰爭", "第一次中日戰爭", "sino-japanese war", "first sino-japanese war"],
    category: "event",
    scope: "高中",
  },
  {
    canonical: "日俄戰爭",
    aliases: ["日俄戰爭時期", "russo-japanese war"],
    category: "event",
    scope: "高中",
  },
  {
    canonical: "普法戰爭",
    aliases: ["法普戰爭", "franco-prussian war"],
    category: "event",
    scope: "高中",
  },
  {
    canonical: "法國大革命",
    aliases: ["法國革命", "french revolution"],
    category: "event",
    scope: "高中",
  },
  {
    canonical: "拿破崙戰爭",
    aliases: ["拿破崙時期戰爭", "napoleonic wars"],
    category: "event",
    scope: "高中",
  },
  {
    canonical: "拿破崙",
    aliases: ["拿破崙一世", "拿破崙波拿巴", "napoleon", "napoleon bonaparte"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "英國光榮革命",
    aliases: ["光榮革命", "glorious revolution"],
    category: "event",
    scope: "高中",
  },
  {
    canonical: "工業革命",
    aliases: ["產業革命", "industrial revolution"],
    category: "event",
    scope: "高中",
  },
  {
    canonical: "民族主義",
    aliases: ["國族主義", "nationalism"],
    category: "reform",
    scope: "高中",
  },
  {
    canonical: "俾斯麥",
    aliases: ["奧托俾斯麥", "otto von bismarck", "bismarck"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "瓦特",
    aliases: ["詹姆斯瓦特", "james watt"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "史蒂芬生",
    aliases: ["史蒂芬孫", "喬治史蒂芬生", "george stephenson", "stephenson"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "達爾文",
    aliases: ["查理斯達爾文", "charles darwin", "darwin"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "達文西",
    aliases: ["達芬奇", "李奧納多達文西", "leonardo da vinci", "da vinci"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "米開朗基羅",
    aliases: ["米高安哲羅", "michelangelo"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "鄭和",
    aliases: ["鄭和船隊", "三寶太監", "zheng he"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "林則徐",
    aliases: ["林則徐禁煙", "lin zexu"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "李鴻章",
    aliases: ["李鴻章洋務", "li hongzhang"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "康有為",
    aliases: ["康南海", "kang youwei"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "梁啟超",
    aliases: ["梁任公", "liang qichao"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "孫中山",
    aliases: ["孫文", "孫逸仙", "sun yat-sen"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "蔣介石",
    aliases: ["蔣中正", "chiang kai-shek"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "毛澤東",
    aliases: ["毛潤之", "mao zedong"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "鄧小平",
    aliases: ["鄧公", "deng xiaoping"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "秦始皇",
    aliases: ["嬴政", "qin shi huang"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "漢武帝",
    aliases: ["劉徹", "han wudi", "emperor wu of han"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "唐太宗",
    aliases: ["李世民", "emperor taizong of tang"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "康熙帝",
    aliases: ["康熙", "清聖祖", "kangxi emperor"],
    category: "person",
    scope: "高中",
  },
  {
    canonical: "乾隆帝",
    aliases: ["乾隆", "清高宗", "qianlong emperor"],
    category: "person",
    scope: "高中",
  },
];

/** 所有寫法（已標準化）→ 課程慣用寫法 */
const canonicalIndex: ReadonlyMap<string, string> = (() => {
  const index = new Map<string, string>();
  for (const group of HISTORY_TERM_GROUPS) {
    for (const term of [group.canonical, ...group.aliases]) {
      const key = normalizeHistoryAnswer(term);
      if (key.length > 0 && !index.has(key)) index.set(key, group.canonical);
    }
  }
  return index;
})();

/** 學生答案所屬的課程慣用寫法；不屬於詞庫時回傳 null */
export function canonicalHistoryTerm(value: string): string | null {
  const key = normalizeHistoryAnswer(value);
  if (key.length === 0) return null;
  return canonicalIndex.get(key) ?? null;
}

/** 詞庫中與指定寫法同組的所有標準化寫法（包含標準答案本身） */
export function historyTermAliases(referenceAnswer: string): string[] {
  const canonical = canonicalHistoryTerm(referenceAnswer) ?? referenceAnswer;
  const group = HISTORY_TERM_GROUPS.find((item) => item.canonical === canonical);
  if (!group) return [];
  return [group.canonical, ...group.aliases]
    .map((term) => normalizeHistoryAnswer(term))
    .filter((term) => term.length > 0);
}

/**
 * 學生的答案與標準答案是否指同一個歷史專名。
 *
 * 判定次序：
 *   1. 標準化後逐字相同；
 *   2. 兩者都屬於詞庫的同一組（例如「一戰」與「第一次世界大戰」）。
 *
 * 標準答案以「/」列出多個可接受寫法時，逐一比對。
 */
export function historyAnswersMatch(studentAnswer: string, referenceAnswer: string): boolean {
  const answer = normalizeHistoryAnswer(studentAnswer);
  if (answer.length === 0) return false;

  const references = referenceAnswer
    .split(/[/／]/)
    .map((part) => normalizeHistoryAnswer(part))
    .filter((part) => part.length > 0);
  if (references.includes(answer)) return true;

  const answerCanonical = canonicalIndex.get(answer);
  if (answerCanonical === undefined) return false;

  return references.some((reference) => {
    const referenceCanonical = canonicalIndex.get(reference) ?? reference;
    return referenceCanonical === answerCanonical;
  });
}
