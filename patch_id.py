with open('backend/src/routes/admin.js', 'r', encoding='utf-8') as f:

    content = f.read()


marker = '    }

    // Insert vouchers into database'
idx = content.find(marker)
if idx >= 0:
    insert_point = idx + 5


    block = '''
