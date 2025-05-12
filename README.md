# 【SDK 设计】
## ✅ 一、设计目标

| 项目   | 描述                          |
| ---- | --------------------------- |
| 适用平台 | Web / App（iOS、Android）      |
| 用户状态 | 匿名用户、登录用户均可识别与追踪            |
| 埋点粒度 | 页面访问、行为事件、转化路径、性能数据、A/B实验   |
| 数据合规 | 支持 GDPR / CCPA / 数据脱敏等合规策略  |
| 模式   | 无侵入式 SDK、插件化设计、灵活配置、自定义事件扩展 |

---

## ✅ 二、SDK 设计架构

```plaintext
[用户浏览器 / APP] 
     ↓
[埋点 SDK] 
     ↓
[本地缓存队列] → [队列合并上报策略（定时、阈值、关键行为）]
     ↓
[数据收集服务接口（自建/三方）]
     ↓
[数据仓库（如 ClickHouse / BigQuery）]
     ↓
[BI 可视化 + 分析模型 + 标签系统]
```

---

## ✅ 三、核心模块拆解

### 1. 初始化模块（init）

* 加载配置（埋点服务器地址、默认字段、是否启用 debug 等）
* 获取或生成 **全局匿名 ID（UUID + fingerprint）**
* 读取本地缓存、历史 session ID

```ts
SDK.init({
  projectId: 'global-crossborder-store',
  server: 'https://tracker.site.com/track',
  autoPageView: true,
  autoClick: true,
  debug: false,
})
```

---

### 2. 用户标识模块（identity）

* 匿名用户使用：localStorage + 指纹识别（Device+Browser+IPHash）
* 登录用户可上报 UID（并自动绑定前后端匿名 ID）

```ts
SDK.setUser({
  uid: '123456789',
  email: 'user@example.com',
  phone: '+1xxx',
})
```

---

### 3. 事件上报模块（track）

通用行为上报接口：

```ts
SDK.track('product_view', {
  productId: 'SKU_987654',
  category: 'beach_hat',
  price: 15.99,
})
```

内置常见行为事件：

| 事件名                | 说明      |
| ------------------ | ------- |
| `page_view`        | 页面加载    |
| `product_view`     | 查看商品详情页 |
| `add_to_cart`      | 加入购物车   |
| `remove_from_cart` | 移出购物车   |
| `begin_checkout`   | 点击结算    |
| `place_order`      | 下单成功    |
| `payment_success`  | 支付成功    |
| `search`           | 搜索行为    |
| `click`            | 自定义点击   |
| `ab_test`          | 实验组曝光   |

---

### 4. 用户会话与来源识别（session & referrer）

* 基于时间戳滑动窗口维护会话（默认 30 分钟）
* 支持识别渠道来源（utm 参数 / referer）
* 区分冷启动 / 激活 / 回访

```ts
SDK.getSession() // { sessionId, isNewSession, referrer, utm_source }
```

---

### 5. 数据发送策略（队列 & 上报）

* 事件打包压缩后批量发送

* 触发时机：

  * 定时轮询（如 10 秒）
  * 队列积累（如 > 10 条）
  * 页面关闭 / 用户行为关键点（如支付成功）

* 网络失败自动重试 + 本地缓存 fallback（IndexedDB / localStorage）

---

### 6. 数据格式标准

```json
{
  "projectId": "global-crossborder-store",
  "event": "add_to_cart",
  "timestamp": "2025-05-12T06:00:00Z",
  "user": {
    "uid": "null",
    "anonymousId": "d09c34d1-a6f4-4d23-bdf2-09ec74c09f1b"
  },
  "device": {
    "os": "iOS",
    "browser": "Safari",
    "lang": "en-US"
  },
  "session": {
    "id": "sess-392bf1",
    "referrer": "https://google.com",
    "utm": {
      "source": "google",
      "campaign": "spring-sale"
    }
  },
  "properties": {
    "productId": "SKU1234",
    "category": "hat",
    "price": 22.5
  }
}
```

---

## ✅ 四、支持功能扩展（可插拔模块）

| 模块         | 说明                         |
| ---------- | -------------------------- |
| **A/B测试**  | 自动曝光统计、组号分配、实验转化归因         |
| **性能埋点**   | 页面 FCP / LCP / CLS / TTI 等 |
| **热图**     | 埋点采集区域坐标，可视化用户点击路径         |
| **自定义标签**  | 绑定用户偏好、生命周期、国家/货币          |
| **数据加密模块** | 保障用户数据隐私，支持对手机号/email 加密上报 |

---

## ✅ 五、SDK 安装与使用方式

* CDN 引入（适合独立站）：支持无依赖运行
* NPM 包安装（适合前端工程集成）
* App SDK：通过桥接 JS 接口或集成原生 SDK 包

---

## ✅ 六、示例场景：匿名用户完成下单

1. 浏览首页 → `page_view`（携带国家、货币）
2. 进入商品页 → `product_view`
3. 加入购物车 → `add_to_cart`
4. 跳转结算页 → `begin_checkout`
5. 成功下单（未登录）→ `place_order`（绑定匿名 ID）
6. 后台系统识别该匿名 ID，记录一次完整转化行为路径

---

