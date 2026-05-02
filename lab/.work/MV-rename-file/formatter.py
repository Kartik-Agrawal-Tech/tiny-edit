class Formatter:
    def format_number(self, n):
        return f"{n:,.2f}"

    def format_list(self, items):
        return ", ".join(str(i) for i in items)


def slugify(text):
    return text.lower().replace(" ", "-")
