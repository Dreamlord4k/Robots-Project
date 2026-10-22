using System.Collections.Generic;

public class PlanResult
{
    public List<Assignment> Assigned { get; set; } = new();
    public List<Order> Unassigned { get; set; } = new();
    public decimal TotalRevenue { get; set; }
}
