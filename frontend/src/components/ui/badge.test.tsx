import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "@/components/ui/badge";

describe("Badge", () => {
  it("renders children", () => {
    render(<Badge>Approved</Badge>);
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("applies secondary variant class", () => {
    render(<Badge variant="secondary">Domain</Badge>);
    const el = screen.getByText("Domain");
    expect(el.className).toMatch(/secondary/);
  });
});
