using System;
using System.Collections.Generic;

class Program
{
    static void Main()
    {
        var orders = new List<Order>
        {
            new Order { Id = "O1", RobotType = "Mini", Price = 1000, HoursRequired = 2 },
            new Order { Id = "O2", RobotType = "Standard", Price = 2500, HoursRequired = 5 },
            new Order { Id = "O3", RobotType = "Heavy", Price = 4000, HoursRequired = 8 },
            new Order { Id = "O4", RobotType = "Mini", Price = 900, HoursRequired = 2 }
        };

        var lines = new List<ProductionLine>
        {
            new ProductionLine { Name = "Line A", AvailableHours = 6 },
            new ProductionLine { Name = "Line B", AvailableHours = 10 }
        };

        var stock = new List<WarehouseStock>
        {
            new WarehouseStock { RobotType = "Mini", Quantity = 2 }
        };

        var result = ProductionPlanner.PlanAssignments(orders, lines, stock);

        Console.WriteLine("=== Выполненные заказы ===");
        foreach (var a in result.Assigned)
        {
            Console.WriteLine($"{a.Order.Id} ({a.Order.RobotType}) — {a.Source}, выручка: {a.Order.Price}");
        }

        Console.WriteLine($"Общая выручка: {result.TotalRevenue}");

        if (result.Unassigned.Count > 0)
        {
            Console.WriteLine("\n=== Не выполнены ===");
            foreach (var o in result.Unassigned)
            {
                Console.WriteLine($"{o.Id} ({o.RobotType}) — не хватило мощностей или нет на складе");
            }
        }
    }
}
