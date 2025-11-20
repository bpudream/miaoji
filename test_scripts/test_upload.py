import requests
import os

def test_upload():
    url = 'http://localhost:3000/api/upload'
    # 创建一个临时文件
    filename = 'test_upload_file.txt'
    with open(filename, 'w') as f:
        f.write('Hello Fastify Upload!')

    files = {'file': open(filename, 'rb')}
    try:
        response = requests.post(url, files=files)
        print(response.json())
    except Exception as e:
        print(f"Error: {e}")
    finally:
        files['file'].close()
        os.remove(filename)

if __name__ == '__main__':
    test_upload()

