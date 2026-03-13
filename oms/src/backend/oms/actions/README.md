# OMS CDP Actions

Reusable CDP-mediated actions for the live OMS browser launched from this module.

## Prerequisites
1. OMS launcher is running:
   - `npm run launch:oms` or `npm run launch:oms:hidden`
2. OMS tab is open and logged in at:
   - `https://oms.xlwms.com/platform/order/list`
3. CDP port is available on localhost (auto-detected from `9222` to `9260`).

## Action: Set Page Size to 2000
From `C:\zhaoYing_english\mgmt\stealth_launcher\oms`:

```powershell
npm run action:page-size-2000
```

What it does:
1. Connects to active CDP browser (`127.0.0.1`, auto-detect port).
2. Finds OMS orders tab.
3. Clicks `span.el-pagination__sizes .el-input__inner`.
4. Waits for visible `div.el-select-dropdown.el-popper`.
5. Clicks the `2000条/页` option.
6. Prints final selected page size.

## Optional Overrides
- Force CDP port:
  - `set CDP_PORT=9223&& npm run action:page-size-2000`
- Change scan range:
  - `set CDP_PORT_START=9222&& set CDP_PORT_END=9260&& npm run action:page-size-2000`
- Change OMS URL matcher:
  - `set OMS_TARGET_URL_FRAGMENT=oms.xlwms.com/platform/order/list&& npm run action:page-size-2000`

## Action: Refresh + Cache Full OMS Rows to Parquet
From `C:\zhaoYing_english\mgmt\stealth_launcher\oms`:

```powershell
npm run action:refresh-cache-parquet
```

What it does:
1. Reloads OMS orders page.
2. Clicks tab `#tab--1`.
3. Ensures page size is set to `2000`.
4. Scrolls to page bottom.
5. Extracts table rows from `div.vxe-table--main-wrapper` (`tbody > tr` descendants).
5. Upserts rows into a single incremental parquet cache file:
   - `C:\zhaoYing_english\mgmt\stealth_launcher\oms\data\oms_cache\oms_orders_cache.parquet`
6. Appends capture metadata to a single parquet file:
   - `C:\zhaoYing_english\mgmt\stealth_launcher\oms\data\oms_cache\oms_orders_cache_meta.parquet`

Output folder:
   - `C:\zhaoYing_english\mgmt\stealth_launcher\oms\data\oms_cache`

Prerequisite for parquet writing:
- Python available with `pandas` + `pyarrow`.

## Action: Refresh + Cache TikTok Orders (Last N Days) to Parquet
From `C:\zhaoYing_english\mgmt\stealth_launcher\oms`:

```powershell
npm run action:refresh-cache-tk-orders-parquet
```

What it does:
1. Calls `getAllOrdersLastNDays` endpoint for configured `shopRoomCode` list.
2. Fetches `days=1` by default.
3. Upserts rows into:
   - `C:\zhaoYing_english\mgmt\stealth_launcher\oms\data\oms_cache\tk_orders_cache.parquet`
4. Appends tick metadata into:
   - `C:\zhaoYing_english\mgmt\stealth_launcher\oms\data\oms_cache\tk_orders_cache_meta.parquet`

Defaults:
- Endpoint:
  - `https://trendyadventurer.wixstudio.io/tb-redo/_functions/getAllOrdersLastNDays`
- Shop rooms:
  - `LG401,LG402,LG402`
- Days:
  - `1`

Optional overrides:
- `set OMS_TK_ORDERS_ENDPOINT=<url>&& npm run action:refresh-cache-tk-orders-parquet`
- `set OMS_TK_SHOP_ROOM_CODES=LG401,LG402,LG403&& npm run action:refresh-cache-tk-orders-parquet`
- `set OMS_TK_ORDERS_DAYS=1&& npm run action:refresh-cache-tk-orders-parquet`

## Tick Loop (1 minute cadence)
Run continuous refresh/cache loop:

```powershell
npm run action:refresh-cache-parquet:loop
```

Defaults:
- Tick cadence: `60000 ms` (1 minute)
- Per tick execution order:
  1. OMS DOM refresh/cache parquet action
  2. TikTok orders refresh/cache parquet action

Optional:
- Override cadence: `set OMS_CACHE_TICK_MS=60000&& npm run action:refresh-cache-parquet:loop`
- One-shot test mode: `set OMS_CACHE_LOOP_ONCE=1&& npm run action:refresh-cache-parquet:loop`
- Disable TikTok orders cache action in loop:
  - `set OMS_TK_CACHE_ENABLED=0&& npm run action:refresh-cache-parquet:loop`
