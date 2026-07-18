# Production data compatibility notes

Before deploying these model constraints against existing data:

- Review and clean mixed-case or otherwise nonconforming product SKUs before relying on uppercase SKU normalization and uniqueness.
- Check historical stock movements for movement types other than `GOODS_RECEIPT` and `GOODS_ISSUE` before enforcing the restricted enum.
- Treat expired refresh-token cleanup, JWT secret rotation, and removal or deactivation of unauthorized users as separate production operations.

These checks are deployment tasks; this repository does not claim they have already been performed on production data.
