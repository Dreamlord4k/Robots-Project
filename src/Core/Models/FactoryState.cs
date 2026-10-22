namespace FactoryChallenge.Core.Models;

// Идея: запись о сделке. Храним и цену, и прибыль по сделке —
// это позволяет панели рисовать «сколько дал каждый робот», а не только общий итог.
public sealed record SaleRecord(
    double AtSeconds,
    string RobotTypeId,
    string CustomerId,
    decimal Price,
    decimal Profit,
    string Note);

// Важно: это mutable-агрегат состояния раунда, а не потокобезопасная структура.
// Эмулятор работает в одном потоке, поэтому блокировки не нужны — и код остаётся читаемым.
public sealed class FactoryState
{
    public FactoryState(
        FactoryConfig config,
        IReadOnlyList<Machine> machines,
        Warehouse warehouse,
        IReadOnlyList<Customer> customers,
        IReadOnlyDictionary<string, RobotType> robots,
        IReadOnlyDictionary<string, Material> materials)
    {
        Config = config;
        Machines = machines;
        Warehouse = warehouse;
        Customers = customers;
        Robots = robots;
        Materials = materials;
    }

    public FactoryConfig Config { get; }
    public IReadOnlyList<Machine> Machines { get; }
    public Warehouse Warehouse { get; }
    public IReadOnlyList<Customer> Customers { get; }
    public IReadOnlyDictionary<string, RobotType> Robots { get; }
    public IReadOnlyDictionary<string, Material> Materials { get; }

    public double NowSeconds { get; set; }
    public double ElapsedSeconds => NowSeconds;

    public decimal Revenue { get; private set; }
    public decimal Costs { get; private set; }
    public decimal Profit => Revenue - Costs;

    public int DeliveriesAccepted { get; private set; }
    public int DeliveriesRejected { get; private set; }
    public int RobotsProduced { get; private set; }
    public int RobotsSold { get; private set; }
    public int OffersRejected { get; private set; }
    public int ScrappedUnits { get; private set; }
    public int OrdersStarted { get; private set; }

    public List<SaleRecord> Sales { get; } = new();
    public List<string> Log { get; } = new();

    private int _nextOrderNumber = 1;

    /// Уникальный номер производственного заказа (заготовки он и переносит по маршруту).
    public string NextOrderId() => $"WO-{_nextOrderNumber++:0000}";

    public void RegisterDeliveryAccepted(int units, decimal cost)
    {
        DeliveriesAccepted++;
        Costs += cost;
    }

    public void RegisterDeliveryRejected() => DeliveriesRejected++;

    public void RegisterOrderStarted() => OrdersStarted++;

    public void RegisterProduction(decimal materialCost, decimal energyCost, decimal storageCost)
    {
        RobotsProduced++;
        Costs += materialCost + energyCost + storageCost;
    }

    public void RegisterScrap(decimal unitCost) => ScrappedUnits++;

    public void RegisterSale(RobotType robot, Customer customer, decimal price, decimal profit, string note)
    {
        RobotsSold++;
        Revenue += price;
        Sales.Add(new SaleRecord(NowSeconds, robot.Id, customer.Id, price, profit, note));
    }

    public void RegisterOfferRejected() => OffersRejected++;

    /// Пишет строку в лог событий. Старые строки вытесняются, чтобы файл не распухал.
    public void LogEvent(string message)
    {
        Log.Add($"[{NowSeconds,7:F1}s] {message}");
        var limit = Config.Output.MaxLogEntries;
        if (limit > 0 && Log.Count > limit)
        {
            Log.RemoveRange(0, Log.Count - limit);
        }
    }
}
