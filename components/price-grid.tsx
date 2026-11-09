import Link from "next/link";
import { CheckoutButton } from "@/app/pricing/_components/checkout-button";
import { plans, type Plan } from "@/lib/site";
import { Icon } from "./icon";

export function PriceGrid({ ids }: { ids?: Plan["id"][] }) {
  const list = ids ? plans.filter((p) => ids.includes(p.id)) : plans;
  return (
    <div className={`price-grid price-grid--${list.length}`}>
      {list.map((plan) => (
        <article key={plan.id} className={`price-card${plan.featured ? " is-featured" : ""}`}>
          {plan.featured ? <span className="badge">最受欢迎</span> : null}
          <div className="price-name">{plan.name}</div>
          <div className="price-value">
            {plan.price}
            <span className="price-unit">{plan.unit}</span>
          </div>
          <div className="price-note">{plan.note}</div>
          <ul className="price-list">
            {plan.features.map((f) => (
              <li key={f}>
                <Icon name="check" size={15} />
                {f}
              </li>
            ))}
          </ul>
          {plan.id === "free" ? (
            <Link href={plan.href} className="btn btn-ghost btn-block">
              {plan.cta}
            </Link>
          ) : (
            <CheckoutButton planId={plan.id} />
          )}
        </article>
      ))}
    </div>
  );
}
