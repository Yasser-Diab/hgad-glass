# ==========================================
# HGAD TELEGRAM BOT
# STABLE SIMPLE VERSION
# ==========================================

import os
import io
import sys
import time
import logging
import unicodedata

import pandas as pd

from dotenv import load_dotenv

from apscheduler.schedulers.background import BackgroundScheduler

from telegram import (
    Update,
    InlineKeyboardButton,
    InlineKeyboardMarkup
)

from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    ContextTypes,
    CallbackQueryHandler,
    filters,
)

from telegram.request import HTTPXRequest

from logging.handlers import RotatingFileHandler

import win32com.client as win32

# ==========================================
# UTF8 FIX
# ==========================================

sys.stdout = io.TextIOWrapper(
    sys.stdout.buffer,
    encoding="utf-8"
)

# ==========================================
# PATHS
# ==========================================

BASE_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

def here(*p):
    return os.path.join(BASE_DIR, *p)

# ==========================================
# OUTPUT FOLDER
# ==========================================

OUTPUT_DIR = r"D:\Order stauts"

os.makedirs(
    OUTPUT_DIR,
    exist_ok=True
)

# ==========================================
# LOGS
# ==========================================

LOG_DIR = r"C:\bot_logs"

os.makedirs(LOG_DIR, exist_ok=True)

LOG_FILE = os.path.join(
    LOG_DIR,
    "bot_service.log"
)

log_handler = RotatingFileHandler(
    LOG_FILE,
    maxBytes=2_000_000,
    backupCount=3,
    encoding="utf-8"
)

logging.basicConfig(
    handlers=[log_handler],
    level=logging.INFO,
    format="%(asctime)s %(levelname)s: %(message)s"
)

# ==========================================
# ENV
# ==========================================

load_dotenv(here(".env"))

def resolve_path(p):

    if not p:
        return None

    return p if os.path.isabs(p) else here(p)

BOT_TOKEN = os.getenv("BOT_TOKEN") or ""

EXCEL_FILE = resolve_path(
    os.getenv("EXCEL_FILE")
    or
    r"D:\HGAD\طلب شراء زجاج.xlsm"
)

SHEET_NAME = (
    os.getenv("SHEET_NAME")
    or
    "الادخال"
)

TELEGRAM_TOPIC_NAME = (
    os.getenv("TELEGRAM_TOPIC_NAME")
    or
    "متابعة الكلف"
)

try:
    TELEGRAM_TOPIC_ID = int(
        os.getenv("TELEGRAM_TOPIC_ID")
        or
        os.getenv("TELEGRAM_MESSAGE_THREAD_ID")
        or
        "0"
    )
except ValueError:
    TELEGRAM_TOPIC_ID = 0

TOPIC_THREADS_BY_CHAT = {}

# ==========================================
# ARABIC NORMALIZE
# ==========================================

RTL_GHOSTS = [
    "\u200f",
    "\u200e",
    "\u202a",
    "\u202b",
    "\u202c",
    "\u202d",
    "\u202e",
    "\ufeff",
    "\u0640"
]

TRANS = str.maketrans({
    "أ": "ا",
    "إ": "ا",
    "آ": "ا",
    "ى": "ي",
    "ة": "ه"
})

def norm_ar(s):

    s = unicodedata.normalize(
        "NFKC",
        str(s)
    )

    for g in RTL_GHOSTS:
        s = s.replace(g, "")

    return s.translate(TRANS).strip()

ARABIC_DIGITS = str.maketrans({
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
    "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
})

def to_latin_digits(value):
    return str(value or "").translate(ARABIC_DIGITS)

def digits_only_message(value):
    text = to_latin_digits(value).strip()
    return text if text.isdigit() else ""

def remember_forum_topic(message):
    chat = getattr(message, "chat", None)
    chat_id = getattr(chat, "id", None)
    thread_id = getattr(message, "message_thread_id", None)
    created = getattr(message, "forum_topic_created", None)
    edited = getattr(message, "forum_topic_edited", None)
    reply = getattr(message, "reply_to_message", None)
    reply_created = getattr(reply, "forum_topic_created", None) if reply else None
    topic_name = (
        getattr(created, "name", None)
        or getattr(edited, "name", None)
        or getattr(reply_created, "name", None)
        or ""
    )
    if chat_id and thread_id and topic_name:
        TOPIC_THREADS_BY_CHAT[(chat_id, norm_ar(topic_name))] = int(thread_id)

def target_topic_thread_id(chat_id):
    if TELEGRAM_TOPIC_ID:
        return TELEGRAM_TOPIC_ID
    return TOPIC_THREADS_BY_CHAT.get((chat_id, norm_ar(TELEGRAM_TOPIC_NAME)), 0)

def is_allowed_topic(update):
    message = update.effective_message
    if not message:
        return False
    remember_forum_topic(message)
    chat = getattr(message, "chat", None)
    chat_id = getattr(chat, "id", None)
    thread_id = getattr(message, "message_thread_id", None)
    if not chat_id or not thread_id:
        return False
    target = target_topic_thread_id(chat_id)
    return bool(target and int(thread_id) == int(target))

# ==========================================
# FIND COLUMNS
# ==========================================

def find_col(df, aliases):

    for a in aliases:

        for c in df.columns:

            if (
                norm_ar(a) == norm_ar(c)
                or
                norm_ar(a) in norm_ar(c)
            ):
                return c

    return None

# ==========================================

def find_col_by_tokens(df, tokens):

    for c in df.columns:

        if all(
            t in norm_ar(c)
            for t in tokens
        ):
            return c

    return None

# ==========================================

def clean_code(value):

    text = to_latin_digits(value).strip().upper()
    text = text.replace("GO-", "").replace("GO", "")
    text = "".join(ch for ch in text if ch.isdigit())

    if not text:
        return ""

    stripped = text.lstrip("0")

    return stripped or "0"

# ==========================================

def code_matches(series, query):

    q = clean_code(query)

    if not q:
        return series.astype(str) == "__NO_MATCH__"

    return series.astype(str).map(clean_code) == q

# ==========================================
# LOAD DATAFRAME
# ==========================================

def load_dataframe():

    try:

        return pd.read_excel(
            EXCEL_FILE,
            sheet_name=SHEET_NAME,
            dtype=str,
            engine="openpyxl"
        )

    except Exception as e:

        logging.error(f"LOAD ERROR: {e}")

        return df_main if 'df_main' in globals() else pd.DataFrame()

# ==========================================

df_main = load_dataframe()

# ==========================================
# TELEGRAM REQUEST
# ==========================================

request = HTTPXRequest(
    connect_timeout=15,
    read_timeout=60
)

# ==========================================
# START
# ==========================================

async def start(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):
    return

# ==========================================
# RELOAD
# ==========================================

async def reload_cmd(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):
    return

# ==========================================
# SEARCH
# ==========================================

async def handle_search(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):

    global df_main

    if not is_allowed_topic(update):
        return

    text = (
        update.message.text or ""
    ).strip()

    text = digits_only_message(text)

    if not text:
        return

    if df_main.empty:
        return

    permit_col = find_col(
        df_main,
        ["رقم الاذن", "رقم الإذن"]
    )

    order_col = find_col(
        df_main,
        ["رقم الطلب", "كود الطلب", "order"]
    )

    if not permit_col and not order_col:
        return

    masks = []

    if permit_col:
        masks.append(
            code_matches(
                df_main[permit_col],
                text
            )
        )

    if order_col:
        masks.append(
            code_matches(
                df_main[order_col],
                text
            )
        )

    result = df_main[masks[0]]

    for mask in masks[1:]:
        result = pd.concat(
            [result, df_main[mask]]
        ).drop_duplicates()

    if result.empty:

        await update.message.reply_text(
            "🙁 لا توجد بيانات"
        )

        return

    row = result.iloc[0]

    reply = [
        f"📦 تفاصيل رقم {text}",
        "────────────────"
    ]

    cols = [
        "العميل",
        "المشروع",
        "رقم الطلب",
        "سعر الأذن",
        "المورد",
        "التاريخ"
    ]

    for col in cols:

        if col in result.columns:

            val = row[col]

            if "تاريخ" in col:

                try:

                    val = pd.to_datetime(
                        val
                    ).strftime("%d-%m-%Y")

                except:
                    pass

            if pd.isna(val):
                val = "-"

            reply.append(
                f"{col}: {val}"
            )

    # ======================================
    # الحسابات
    # ======================================

    rec_col = find_col_by_tokens(
        df_main,
        ["استلام"]
    )

    rem_col = find_col_by_tokens(
        df_main,
        ["متبقي"]
    )

    qty_col = find_col_by_tokens(
        df_main,
        ["عدد"]
    )

    def to_num(series):

        return pd.to_numeric(
            series,
            errors="coerce"
        ).fillna(0).sum()

    total_received = (
        to_num(result[rec_col])
        if rec_col else 0
    )

    total_remaining = (
        to_num(result[rem_col])
        if rem_col else 0
    )

    total_qty = (
        to_num(result[qty_col])
        if qty_col else 0
    )

    reply.append(
        f"عدد الاستلام: {int(total_received)}"
    )

    reply.append(
        f"العدد المتبقي: {int(total_remaining)}"
    )

    reply.append(
        f"إجمالي العدد: {int(total_qty)}"
    )

    # ======================================
    # ORDER STATUS
    # ======================================

    if total_remaining > 0:

        reply.append(
            "حالة الأوردر: ❌ لم يتم الاستلام من المورد"
        )

    else:

        reply.append(
            "حالة الأوردر: ✅ تم الاستلام من المورد"
        )

    await update.message.reply_text(
        "\n".join(reply)
    )

# ==========================================
# GET SUPPLIERS
# ==========================================

def get_suppliers():

    supplier_col = find_col(
        df_main,
        ["المورد"]
    )

    vals = (
        df_main[supplier_col]
        .dropna()
        .astype(str)
        .str.strip()
        .unique()
        .tolist()
    )

    vals = [v for v in vals if v]

    return sorted(vals)

# ==========================================
# REPORT COMMAND
# ==========================================

async def hosr_cmd(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):
    return

# ==========================================
# SUPPLIER CALLBACK
# ==========================================

async def supplier_callback(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):

    query = update.callback_query
    return

# ==========================================
# CREATE PDF
# ==========================================

def create_excel_pdf(supplier):

    global df_main

    pdf_name = f"hosr_{supplier}.pdf"

    pdf_path = os.path.join(
        OUTPUT_DIR,
        pdf_name
    )

    if os.path.exists(pdf_path):

        try:
            os.remove(pdf_path)
        except:
            pass

    excel = win32.DispatchEx(
        "Excel.Application"
    )

    excel.Visible = False
    excel.DisplayAlerts = False

    wb = excel.Workbooks.Open(
        os.path.abspath(EXCEL_FILE)
    )

    ws = wb.Sheets(1)

    ws.Range("A8:I5000").ClearContents()

    df = df_main.copy()

    supplier_col = find_col(
        df,
        ["المورد"]
    )

    remain_col = find_col_by_tokens(
        df,
        ["متبقي"]
    )

    filtered = df[
        (
            df[supplier_col]
            .astype(str)
            .str.strip() == supplier
        )
    ]

    filtered = filtered[
        pd.to_numeric(
            filtered[remain_col],
            errors="coerce"
        ).fillna(0) > 0
    ]

    start_row = 8

    for i, (_, row) in enumerate(
        filtered.iterrows(),
        start=start_row
    ):

        ws.Cells(i, 1).Value = row.get("رقم الإذن", "")
        ws.Cells(i, 2).Value = row.get("العميل", "")
        ws.Cells(i, 3).Value = row.get("نوع الزجاج", "")
        ws.Cells(i, 4).Value = row.get("رقم الطلب", "")
        ws.Cells(i, 5).Value = row.get("العدد", "")
        ws.Cells(i, 6).Value = row.get("عدد الاستلام", "")
        ws.Cells(i, 7).Value = row.get("العدد المتبقي", "")
        ws.Cells(i, 8).Value = row.get("المساحة", "")
        ws.Cells(i, 9).Value = row.get("سعر الأذن", "")

    ws.Range("H2").Value = supplier

    time.sleep(1)

    wb.ExportAsFixedFormat(
        0,
        pdf_path
    )

    wb.Close(False)

    excel.Quit()

    return pdf_path

# ==========================================
# EXPORT CALLBACK
# ==========================================

async def export_callback(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):

    query = update.callback_query
    return

# ==========================================
# ERROR HANDLER
# ==========================================

async def error_handler(
    update,
    context
):

    logging.exception(
        "Error:",
        exc_info=context.error
    )

# ==========================================
# AUTO RELOAD
# ==========================================

def auto_reload():

    global df_main

    try:

        new_df = load_dataframe()

        if not new_df.empty:

            df_main = new_df

            logging.info("DATA UPDATED")

    except Exception as e:

        logging.error(f"AUTO RELOAD ERROR: {e}")

# ==========================================
# MAIN
# ==========================================

def main():

    app = (
        Application.builder()
        .token(BOT_TOKEN)
        .request(request)
        .build()
    )

    app.add_handler(
        CommandHandler(
            "start",
            start
        )
    )

    app.add_handler(
        CommandHandler(
            "reload",
            reload_cmd
        )
    )

    app.add_handler(
        CommandHandler(
            "report",
            hosr_cmd
        )
    )

    app.add_handler(
        MessageHandler(
            filters.TEXT & ~filters.COMMAND,
            handle_search
        )
    )

    app.add_handler(
        CallbackQueryHandler(
            supplier_callback,
            pattern="^supplier\\|"
        )
    )

    app.add_handler(
        CallbackQueryHandler(
            export_callback,
            pattern="^export\\|"
        )
    )

    app.add_error_handler(
        error_handler
    )

    scheduler = BackgroundScheduler()

    scheduler.add_job(
        auto_reload,
        "interval",
        seconds=30
    )

    scheduler.start()

    print("🤖 BOT RUNNING...")

    app.run_polling()

# ==========================================

if __name__ == "__main__":
    main()
