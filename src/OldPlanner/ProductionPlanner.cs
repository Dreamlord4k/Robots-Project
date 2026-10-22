using System;
using System.Collections.Generic;
using System.Linq;

public static class ProductionPlanner
{
    public static PlanResult PlanAssignments(
        List<Order> orders,
        List<ProductionLine> lines,
        List<WarehouseStock> stock)
    {
        var result = new PlanResult();
        var stockCopy = stock.ToList();
        var linesCopy = lines.ToList();

        // Жадная сортировка: сначала самые дорогие
        var sortedOrders = orders.OrderByDescending(o => o.Price).ToList();

        foreach (var order in sortedOrders)
        {
            // Сначала пробуем со склада
            var stockItem = stockCopy.FirstOrDefault(s => s.RobotType == order.RobotType && s.Quantity > 0);
            if (stockItem != null)
            {
                stockItem.Quantity--;
                result.Assigned.Add(new Assignment
                {
                    Order = order,
                    Source = "Warehouse",
                    HoursUsed = 0
                });
                result.TotalRevenue += order.Price;
                continue;
            }

            // Потом ищем линию
            var line = linesCopy.FirstOrDefault(l => l.AvailableHours >= order.HoursRequired);
            if (line != null)
            {
                line.AvailableHours -= order.HoursRequired;
                result.Assigned.Add(new Assignment
                {
                    Order = order,
                    Source = $"Line: {line.Name}",
                    HoursUsed = order.HoursRequired
                });
                result.TotalRevenue += order.Price;
                continue;
            }

            // Не получилось — в невыполненные
            result.Unassigned.Add(order);
        }

        return result;
    }
}
