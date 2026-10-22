```mermaid
graph TD
    classDef input fill:#e1f5fe,stroke:#0277bd;
    classDef process fill:#fff3e0,stroke:#ef6c00;
    classDef output fill:#e8f5e9,stroke:#2e7d32;
    classDef decision fill:#ffebee,stroke:#c62828;

    A[Вход: JSON-файлы]:::input
    A --> B[Загрузить orders.json, lines.json, stock.json]:::process
    B --> C{Данные валидны?}:::decision
    C -- Нет --> D[Ошибка, завершить]:::output
    C -- Да --> E[Сортировать заказы по цене (убывание)]:::process

    E --> F{Есть на складе?}:::decision
    F -- Да --> G[Отгрузить со склада]:::process
    F -- Нет --> H{Хватает часов на линии?}:::decision

    H -- Да --> I[Назначить на линию]:::process
    H -- Нет --> J[Пометить как невыполненный]:::output

    G --> K[Записать в Assigned]:::process
    I --> K
    J --> L[Записать в Unassigned]:::process

    K --> M[Подсчитать выручку]:::process
    L --> N[Подсчитать статистику по типам]:::process

    M --> O[Сформировать PlanResult]:::process
    N --> O

    O --> P[Вывод в консоль: заказы, выручка, статистика]:::output
```
