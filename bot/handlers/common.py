from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery

router = Router()


@router.callback_query(F.data == "cancel")
async def generic_cancel(cb: CallbackQuery, state: FSMContext):
    """Единая кнопка «Отмена» для всех FSM-потоков."""
    await state.clear()
    try:
        await cb.message.edit_text("Отменено.")
    except Exception:
        pass
    await cb.answer()
