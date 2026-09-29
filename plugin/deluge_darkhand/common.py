import os.path

from pkg_resources import resource_filename


def get_resource(filename):
    return resource_filename(__package__, os.path.join('data', filename))
