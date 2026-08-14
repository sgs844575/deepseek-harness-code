import { useState } from 'react';
import type { TodoItemUi } from '../state/sessionStore';

/**
 * 任务面板：渲染会话最新的 todo/write 快照（整表替换语义）。
 * 折叠态保留进度条 + 完成计数，展开显示逐条任务。
 */

const STATUS_ICON: Record<TodoItemUi['status'], string> = {
  pending: '○',
  in_progress: '◐',
  completed: '✔',
};

const STATUS_LABEL: Record<TodoItemUi['status'], string> = {
  pending: '待办',
  in_progress: '进行中',
  completed: '已完成',
};

export function TodoPanel({ todos }: { todos: TodoItemUi[] }) {
  const [open, setOpen] = useState(true);
  if (todos.length === 0) return null;

  const completed = todos.filter((todo) => todo.status === 'completed').length;
  const percent = Math.round((completed / todos.length) * 100);

  return (
    <details className="todopanel" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span className="todopanel__title">任务</span>
        <span className="todopanel__count">
          {completed}/{todos.length}
        </span>
        <span className="todopanel__progress" aria-hidden>
          <span className="todopanel__progress-bar" style={{ width: `${percent}%` }} />
        </span>
      </summary>
      <ul className="todopanel__list">
        {todos.map((todo, index) => (
          <li
            key={`${index}-${todo.content}`}
            className={`todopanel__item todopanel__item--${todo.status}`}
            title={STATUS_LABEL[todo.status]}
          >
            <span className={`todopanel__icon todopanel__icon--${todo.status}`}>
              {STATUS_ICON[todo.status]}
            </span>
            <span>{todo.content}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
