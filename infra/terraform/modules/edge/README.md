# edge module

CloudFront + ACM TLS certs + AWS WAF web ACL. Fronts the ALB for `api.*` and the SPA bucket for `app.*`.

## Critical WAF rules (Phase 3E — KOL guest route)

The public `/kol-review/:token` route (Module E) is one of the two internet-facing attack surfaces (the other being login). WAF rules:

- Rate limit per IP (default: 100 req / 5 min for `/kol-review/*`)
- Managed rule groups: AWSManagedRulesCommonRuleSet, KnownBadInputsRuleSet, SQLiRuleSet, AnonymousIpListRuleSet
- Geo-block for high-risk regions (configurable per customer)
- Block requests missing the token path parameter
- Block oversized request bodies on the guest route

## Certificates

- Wildcard ACM cert for `*.<customer>.clinwrite.ai` per tenant
- DNS validation via Route 53
- Auto-renewal via ACM
