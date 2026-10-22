namespace FactoryChallenge.Core.Models;

public enum MachineState
{
    Idle,
    Busy
}

public sealed class Machine
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;

    // Важно: свойство названо Handles, а не Operation, чтобы не путать его с типом Operation
    // в выражениях вида machine.Handles == Operation.Cutting.
    public Operation Handles { get; init; }

    /// Базовое время одной операции для «эталонной» заготовки (множитель 1.0).
    public double SecondsPerUnit { get; init; } = 10;

    /// Больше 1 — станок быстрее норматива (модернизирован), меньше 1 — изношен.
    public double SpeedFactor { get; init; } = 1.0;

    /// Переналадка при переходе на другой тип робота. Одна из причин держать партии однотипными.
    public double SetupSeconds { get; init; }

    public double PowerKw { get; init; }
    public double DefectRate { get; init; }

    public MachineState State { get; private set; } = MachineState.Idle;
    public string? CurrentOrderId { get; private set; }
    public string? CurrentRobotTypeId { get; private set; }
    public double BusyUntilSeconds { get; private set; }

    public int CompletedOperations { get; private set; }
    public double BusySecondsTotal { get; private set; }

    public bool IsIdle => State == MachineState.Idle;

    public bool Supports(Operation operation) => Handles == operation;

    // Идея: время = базовое время станка × множитель шага рецепта / коэффициент скорости.
    // Max(0.1, ...) защищает от деления на ноль, если в JSON случайно вписали 0.
    public double SecondsFor(RobotType robot)
    {
        var step = robot.Recipe.FirstOrDefault(s => s.Operation == Handles);
        return step is null
            ? 0
            : SecondsPerUnit * step.TimeMultiplier / Math.Max(0.1, SpeedFactor);
    }

    // Важно: если станок уже настроен на этот тип робота, переналадки нет — это и создаёт выгоду от партий.
    public double SetupSecondsFor(RobotType robot) =>
        CurrentRobotTypeId == robot.Id ? 0 : SetupSeconds;

    public double EstimateTotalSeconds(RobotType robot) =>
        SecondsFor(robot) + SetupSecondsFor(robot);

    public void Start(string orderId, RobotType robot, double nowSeconds)
    {
        var duration = EstimateTotalSeconds(robot);
        State = MachineState.Busy;
        CurrentOrderId = orderId;
        CurrentRobotTypeId = robot.Id;
        BusyUntilSeconds = nowSeconds + duration;
        BusySecondsTotal += duration;
        CompletedOperations++;
    }

    public void Release()
    {
        State = MachineState.Idle;
        CurrentOrderId = null;
    }

    /// Насколько станок загружен относительно времени раунда (0..1). Используется панелью и стратегией.
    public double LoadRatio(double elapsedSeconds) =>
        elapsedSeconds <= 0 ? 0 : Math.Clamp(BusySecondsTotal / elapsedSeconds, 0, 1);
}
