namespace FactoryChallenge.Core.Models;

// Идея: заготовка — конкретная единица продукции в производстве.
// CompletedSteps показывает, сколько шагов рецепта уже пройдено: именно по нему стратегия
// понимает, на какой станок заготовку можно отправить дальше.
public sealed class Workpiece
{
    public string OrderId { get; init; } = string.Empty;
    public string RobotTypeId { get; init; } = string.Empty;
    public int CompletedSteps { get; set; }
    public double CreatedAtSeconds { get; init; }
}

public sealed class Warehouse
{
    public double CapacitySlots { get; }
    public double SlotVolume { get; }

    /// Сколько слотов занимает готовый робот (он объёмнее заготовки).
    public double FinishedRobotSlots { get; }

    private readonly Dictionary<string, int> _materials = new();
    private readonly List<Workpiece> _workpieces = new();
    private readonly Dictionary<string, int> _finished = new();

    public Warehouse(double capacitySlots, double slotVolume = 1.0, double finishedRobotSlots = 2.0)
    {
        CapacitySlots = Math.Max(1, capacitySlots);
        SlotVolume = Math.Max(0.001, slotVolume);
        FinishedRobotSlots = Math.Max(0.001, finishedRobotSlots);
    }

    public IReadOnlyDictionary<string, int> Materials => _materials;
    public IReadOnlyList<Workpiece> Workpieces => _workpieces;
    public IReadOnlyDictionary<string, int> Finished => _finished;

    public int MaterialUnits => _materials.Values.Sum();
    public int FinishedCount => _finished.Values.Sum();

    public double UsedSlots =>
        _materials.Sum(kv =>
        {
            var volume = 1.0;
            // Объём берём из справочника, если он подставлен стратегией/эмулятором через ResolveVolume.
            volume = _volumes.TryGetValue(kv.Key, out var v) ? v : 1.0;
            return kv.Value * volume / SlotVolume;
        })
        + _workpieces.Count
        + FinishedCount * FinishedRobotSlots;

    private readonly Dictionary<string, double> _volumes = new();

    /// Идея: склад не хранит справочник материалов — он только узнаёт объёмы один раз при загрузке конфига.
    public void RegisterVolumes(IEnumerable<Material> materials)
    {
        foreach (var material in materials) _volumes[material.Id] = material.Volume;
    }

    /// Заполненность 0..1 — основной сигнал для решения «принимать ли поставку».
    public double FillRatio => Math.Clamp(UsedSlots / CapacitySlots, 0, 2);

    public bool IsOverloaded => UsedSlots > CapacitySlots;

    public int Count(string materialId) =>
        _materials.TryGetValue(materialId, out var count) ? count : 0;

    /// Хватит ли места, если принять ещё quantity единиц этого материала.
    public bool CanAccept(string materialId, int quantity)
    {
        var volume = _volumes.TryGetValue(materialId, out var v) ? v : 1.0;
        var extraSlots = quantity * volume / SlotVolume;
        return UsedSlots + extraSlots <= CapacitySlots;
    }

    public void AddMaterials(string materialId, int quantity)
    {
        if (quantity <= 0) return;
        _materials[materialId] = Count(materialId) + quantity;
    }

    /// Есть ли на складе полный комплект под этого робота.
    public bool HasMaterialsFor(RobotType robot) =>
        robot.Materials.All(req => Count(req.MaterialId) >= req.Quantity);

    /// Списывает комплект материалов. Возвращает false, если чего-то не хватило (ничего не меняя).
    public bool TryTakeMaterialsFor(RobotType robot)
    {
        if (!HasMaterialsFor(robot)) return false;

        foreach (var req in robot.Materials)
        {
            var left = Count(req.MaterialId) - req.Quantity;
            if (left <= 0) _materials.Remove(req.MaterialId);
            else _materials[req.MaterialId] = left;
        }
        return true;
    }

    public void AddWorkpiece(Workpiece workpiece) => _workpieces.Add(workpiece);

    public Workpiece? FindWorkpiece(Func<Workpiece, bool> predicate) =>
        _workpieces.FirstOrDefault(predicate);

    public bool RemoveWorkpiece(Workpiece workpiece) => _workpieces.Remove(workpiece);

    public void AddFinished(string robotTypeId, int count = 1)
    {
        _finished[robotTypeId] = (_finished.TryGetValue(robotTypeId, out var c) ? c : 0) + count;
    }

    public bool TryTakeFinished(string robotTypeId)
    {
        if (!_finished.TryGetValue(robotTypeId, out var count) || count <= 0) return false;

        if (count == 1) _finished.Remove(robotTypeId);
        else _finished[robotTypeId] = count - 1;
        return true;
    }

    /// Стоимость хранения за период: занимаемые слоты × секунды × тариф из config.json.
    public decimal StorageCost(double seconds, decimal costPerSlotSecond) =>
        (decimal)(UsedSlots * seconds) * costPerSlotSecond;
}
