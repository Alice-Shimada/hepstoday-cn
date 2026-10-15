"""Metadata is extracted from the listing by ArxivSpider; no API calls needed."""


class DailyArxivPipeline:
    def process_item(self, item: dict, spider):
        return item
